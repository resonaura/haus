use crate::{CompositorGpuHint, WgpuAtlas, WgpuContext};
use anyhow::{Context as _, Result};
use bytemuck::{Pod, Zeroable};
use collections::FxHashMap;
use gpui::{
    AtlasTextureId, Background, BlurPasses, Bounds, DevicePixels, GAUSSIAN_REACH, GpuSpecs,
    KAWASE_LEVELS, Kawase, LayerEffect, Path, Point, PrimitiveBatch, ScaledPixels, Scene, ShaderId,
    Size, get_gamma_correction_ratios, point, size,
};
use log::warn;
#[cfg(not(target_family = "wasm"))]
use raw_window_handle::{HasDisplayHandle, HasWindowHandle};
use std::cell::RefCell;
use std::num::NonZeroU64;
use std::ops::Range;
use std::rc::Rc;
use std::sync::{Arc, Mutex};
use web_time::{Duration, Instant};

const MAX_INSTANCE_BUFFER_SIZE: u64 = 256 * 1024 * 1024;

/// How long an offscreen target may go unused before its memory is given back.
const IDLE_RELEASE: Duration = Duration::from_secs(2);

/// How deeply filtered layers can nest before the innermost ones stop being filtered.
const LAYER_DEPTH: usize = 8;

const INSTANCE_TEXTURE_TEXEL_SIZE: u64 = 16;

/// Shader variant for backends with storage buffer support: the shared shader
/// logic plus the storage-buffer instance transport.
const STORAGE_BUFFER_SHADERS: &str = concat!(
    include_str!("shaders.wgsl"),
    include_str!("shaders_storage.wgsl"),
);

/// Shader variant for WebGL2, which has no storage buffers: the shared shader
/// logic plus the texture-based instance transport.
const WEBGL_SHADERS: &str = concat!(
    include_str!("shaders.wgsl"),
    include_str!("shaders_webgl.wgsl"),
);

/// Subpixel text rendering requires dual-source blending, which WebGL2 lacks, so
/// this variant only ever runs with the storage-buffer transport. The `enable`
/// directive must precede all declarations.
const SUBPIXEL_SHADERS: &str = concat!(
    "enable dual_source_blending;\n",
    include_str!("shaders.wgsl"),
    include_str!("shaders_storage.wgsl"),
    include_str!("shaders_subpixel.wgsl"),
);

/// How custom shaders read their instances on WebGL2, in place of the storage buffer transport.
const CUSTOM_SHADER_WEBGL_TRANSPORT: &str = include_str!("custom_shader_webgl.wgsl");

fn least_common_multiple(left: u64, right: u64) -> u64 {
    let mut first = left;
    let mut second = right;
    while second != 0 {
        let remainder = first % second;
        first = second;
        second = remainder;
    }
    left / first * right
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct GlobalParams {
    viewport_size: [f32; 2],
    premultiplied_alpha: u32,
    pad: u32,
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct PodBounds {
    origin: [f32; 2],
    size: [f32; 2],
}

impl From<Bounds<ScaledPixels>> for PodBounds {
    fn from(bounds: Bounds<ScaledPixels>) -> Self {
        Self {
            origin: [bounds.origin.x.0, bounds.origin.y.0],
            size: [bounds.size.width.0, bounds.size.height.0],
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct SurfaceParams {
    bounds: PodBounds,
    content_mask: PodBounds,
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct GammaParams {
    gamma_ratios: [f32; 4],
    grayscale_enhanced_contrast: f32,
    subpixel_enhanced_contrast: f32,
    is_bgr: u32,
    _pad: u32,
}

#[derive(Clone, Debug)]
#[repr(C)]
struct PathSprite {
    bounds: Bounds<ScaledPixels>,
}

#[derive(Clone, Debug)]
#[repr(C)]
struct PathRasterizationVertex {
    xy_position: Point<ScaledPixels>,
    st_position: Point<f32>,
    color: Background,
    bounds: Bounds<ScaledPixels>,
}

pub struct WgpuSurfaceConfig {
    pub size: Size<DevicePixels>,
    pub transparent: bool,
    /// Preferred presentation mode. When `Some`, the renderer will use this
    /// mode if supported by the surface, falling back to `Fifo`.
    /// When `None`, defaults to `Fifo` (VSync).
    ///
    /// Mobile platforms may prefer `Mailbox` (triple-buffering) to avoid
    /// blocking in `get_current_texture()` during lifecycle transitions.
    pub preferred_present_mode: Option<wgpu::PresentMode>,
}

struct WgpuPipelines {
    backdrops: wgpu::RenderPipeline,
    backdrop_punch: wgpu::RenderPipeline,
    gaussian: wgpu::RenderPipeline,
    kawase_down: wgpu::RenderPipeline,
    kawase_up: wgpu::RenderPipeline,
    blit: wgpu::RenderPipeline,
    composite: wgpu::RenderPipeline,
    masked: wgpu::RenderPipeline,
    /// Composites a layer blurred across only, running the gaussian down on the way.
    blurred: wgpu::RenderPipeline,
    quads: wgpu::RenderPipeline,
    shadows: wgpu::RenderPipeline,
    path_rasterization: wgpu::RenderPipeline,
    paths: wgpu::RenderPipeline,
    underlines: wgpu::RenderPipeline,
    mono_sprites: wgpu::RenderPipeline,
    subpixel_sprites: Option<wgpu::RenderPipeline>,
    /// The same glyphs for when they land in an offscreen layer rather than the frame.
    subpixel_sprites_layered: Option<wgpu::RenderPipeline>,
    poly_sprites: wgpu::RenderPipeline,
    #[allow(dead_code)]
    surfaces: wgpu::RenderPipeline,
    /// The colour target custom shader pipelines are created against, the same as quads draw to.
    custom_target: wgpu::ColorTargetState,
    /// A pipeline per custom shader, created the first time a frame draws it.
    custom: FxHashMap<ShaderId, Option<wgpu::RenderPipeline>>,
}

/// One frame allocation of instance data, ready to bind.
struct InstanceBinding {
    bind_group: wgpu::BindGroup,
    /// Index of the allocation's first instance within the bound data. Always
    /// zero on the storage-buffer path, where the binding offset already
    /// positions the array; on the WebGL texture path the shader indexes the
    /// shared instance texture absolutely, so draws must offset their
    /// instance (or vertex) ranges by this value.
    first_instance: u32,
}

struct InstanceBindings {
    backdrops: InstanceBinding,
    quads: InstanceBinding,
    shaders: InstanceBinding,
    shadows: InstanceBinding,
    underlines: InstanceBinding,
    monochrome_sprites: InstanceBinding,
    subpixel_sprites: InstanceBinding,
    polychrome_sprites: InstanceBinding,
}

struct WgpuBindGroupLayouts {
    globals: wgpu::BindGroupLayout,
    custom_backdrop_globals: wgpu::BindGroupLayout,
    instances: wgpu::BindGroupLayout,
    texture: wgpu::BindGroupLayout,
    surfaces: wgpu::BindGroupLayout,
}

#[repr(C, align(16))]
#[derive(Clone, Copy, Default)]
struct MaskParams {
    source_bounds: [f32; 4],
    fade_bounds: [f32; 4],
    transform_origin: [f32; 2],
    translation: [f32; 2],
    inv_matrix: [f32; 4],
    fwd_matrix: [f32; 4],
    fade_top: f32,
    fade_bottom: f32,
    fade_left: f32,
    fade_right: f32,
    clip_radii: [f32; 4],
    clip_smoothing: f32,
    transform_flags: u32,
    gaussian_sigma: f32,
    _pad0: u32,
}

const _: () = {
    assert!(std::mem::size_of::<MaskParams>() == 32 * std::mem::size_of::<f32>());
    assert!(std::mem::align_of::<MaskParams>() == 16);
    assert!(std::mem::offset_of!(MaskParams, source_bounds) == 0);
    assert!(std::mem::offset_of!(MaskParams, fade_bounds) == 16);
    assert!(std::mem::offset_of!(MaskParams, transform_origin) == 32);
    assert!(std::mem::offset_of!(MaskParams, translation) == 40);
    assert!(std::mem::offset_of!(MaskParams, inv_matrix) == 48);
    assert!(std::mem::offset_of!(MaskParams, fwd_matrix) == 64);
    assert!(std::mem::offset_of!(MaskParams, fade_top) == 80);
    assert!(std::mem::offset_of!(MaskParams, fade_bottom) == 84);
    assert!(std::mem::offset_of!(MaskParams, fade_left) == 88);
    assert!(std::mem::offset_of!(MaskParams, fade_right) == 92);
    assert!(std::mem::offset_of!(MaskParams, clip_radii) == 96);
    assert!(std::mem::offset_of!(MaskParams, clip_smoothing) == 112);
    assert!(std::mem::offset_of!(MaskParams, transform_flags) == 116);
    assert!(std::mem::offset_of!(MaskParams, gaussian_sigma) == 120);
    assert!(std::mem::offset_of!(MaskParams, _pad0) == 124);
};

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct BlurParams {
    direction: [f32; 2],
    radius: f32,
    pad: u32,
}

/// An offscreen render target that is created the first time a frame needs it and released
/// once it has gone `IDLE_RELEASE` without use.
struct Scratch {
    texture: wgpu::Texture,
    view: wgpu::TextureView,
    used: Instant,
}

impl Scratch {
    fn new(
        device: &wgpu::Device,
        label: &str,
        format: wgpu::TextureFormat,
        size: (u32, u32),
        sample_count: u32,
        usage: wgpu::TextureUsages,
        now: Instant,
    ) -> Self {
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some(label),
            size: wgpu::Extent3d {
                width: size.0.max(1),
                height: size.1.max(1),
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        Self {
            texture,
            view,
            used: now,
        }
    }

    fn touch(&mut self, now: Instant) -> wgpu::TextureView {
        self.used = now;
        self.view.clone()
    }
}

/// One of the offscreen targets filters draw through.
#[derive(Clone, Copy)]
enum FilterTarget {
    Backdrop,
    Frame,
    Layer(usize),
    Level(usize),
    Scratch,
}

impl FilterTarget {
    fn shrink(self) -> u32 {
        match self {
            Self::Level(level) => 1 << level,
            Self::Frame | Self::Layer(_) | Self::Scratch | Self::Backdrop => 1,
        }
    }

    fn label(self) -> String {
        match self {
            Self::Backdrop => "backdrop_source".into(),
            Self::Frame => "backdrop_frame".into(),
            Self::Layer(depth) => format!("filter_layer_{depth}"),
            Self::Level(level) => format!("blur_{level}"),
            Self::Scratch => "blur_scratch".into(),
        }
    }
}

#[derive(Default)]
struct FilterTargets {
    frame: Option<Scratch>,
    backdrop: Option<Scratch>,
    layers: [Option<Scratch>; LAYER_DEPTH],
    levels: [Option<Scratch>; KAWASE_LEVELS + 1],
    scratch: Option<Scratch>,
}

impl FilterTargets {
    fn slot(&mut self, target: FilterTarget) -> &mut Option<Scratch> {
        match target {
            FilterTarget::Backdrop => &mut self.backdrop,
            FilterTarget::Frame => &mut self.frame,
            FilterTarget::Layer(depth) => &mut self.layers[depth],
            FilterTarget::Level(level) => &mut self.levels[level],
            FilterTarget::Scratch => &mut self.scratch,
        }
    }

    fn slots(&mut self) -> impl Iterator<Item = &mut Option<Scratch>> {
        std::iter::once(&mut self.frame)
            .chain(std::iter::once(&mut self.backdrop))
            .chain(self.layers.iter_mut())
            .chain(self.levels.iter_mut())
            .chain(std::iter::once(&mut self.scratch))
    }
}

/// Shared GPU context reference, used to coordinate device recovery across multiple windows.
pub type GpuContext = Rc<RefCell<Option<WgpuContext>>>;

enum InstanceData {
    Storage(wgpu::Buffer),
    // WebGL2 has no storage buffers. A uint texture keeps the records available to both shader
    // stages while preserving integer and floating-point bit patterns exactly.
    Texture {
        texture: wgpu::Texture,
        view: wgpu::TextureView,
        width: u32,
        height: u32,
    },
}

/// GPU resources that must be dropped together during device recovery.
struct WgpuResources {
    device: Arc<wgpu::Device>,
    queue: Arc<wgpu::Queue>,
    /// `None` for an offscreen renderer, which draws into `readback` instead.
    surface: Option<wgpu::Surface<'static>>,
    readback: Option<Readback>,
    pipelines: WgpuPipelines,
    bind_group_layouts: WgpuBindGroupLayouts,
    atlas_sampler: wgpu::Sampler,
    filter_sampler: wgpu::Sampler,
    #[allow(dead_code)]
    surface_sampler: wgpu::Sampler,
    #[allow(dead_code)]
    surface_uniform_buffer: wgpu::Buffer,
    globals_buffer: wgpu::Buffer,
    globals_bind_group: wgpu::BindGroup,
    path_globals_bind_group: wgpu::BindGroup,
    instance_data: InstanceData,
    path_intermediate: Option<Scratch>,
    path_msaa: Option<Scratch>,
    filter_targets: FilterTargets,
}

/// Offscreen render target plus the buffer its pixels are copied into.
struct Readback {
    texture: wgpu::Texture,
    view: wgpu::TextureView,
    buffer: wgpu::Buffer,
    width: u32,
    height: u32,
    /// wgpu requires buffer rows aligned to `COPY_BYTES_PER_ROW_ALIGNMENT`.
    padded_bytes_per_row: u32,
}

impl WgpuResources {
    fn invalidate_intermediate_textures(&mut self) {
        let paths = [&mut self.path_intermediate, &mut self.path_msaa];
        for slot in paths.into_iter().chain(self.filter_targets.slots()) {
            if let Some(scratch) = slot.take() {
                scratch.texture.destroy();
            }
        }
    }

    fn release_targets_idle_at(&mut self, now: Instant) {
        let paths = [&mut self.path_intermediate, &mut self.path_msaa];
        for slot in paths.into_iter().chain(self.filter_targets.slots()) {
            if slot
                .as_ref()
                .is_some_and(|scratch| now.duration_since(scratch.used) >= IDLE_RELEASE)
            {
                *slot = None;
            }
        }
    }
}

pub struct WgpuRenderer {
    /// Shared GPU context for device recovery coordination (unused on WASM).
    #[allow(dead_code)]
    context: Option<GpuContext>,
    /// Compositor GPU hint for adapter selection (unused on WASM).
    #[allow(dead_code)]
    compositor_gpu: Option<CompositorGpuHint>,
    resources: Option<WgpuResources>,
    surface_config: wgpu::SurfaceConfiguration,
    atlas: Arc<WgpuAtlas>,
    path_globals_offset: u64,
    gamma_offset: u64,
    instance_data_capacity: u64,
    max_instance_data_size: u64,
    instance_data_alignment: u64,
    uses_webgl_instance_data: bool,
    frame_time: Instant,
    frame_size: (u32, u32),
    rendering_params: RenderingParameters,
    is_bgr: bool,
    dual_source_blending: bool,
    adapter_info: wgpu::AdapterInfo,
    transparent_alpha_mode: wgpu::CompositeAlphaMode,
    opaque_alpha_mode: wgpu::CompositeAlphaMode,
    max_texture_size: u32,
    last_error: Arc<Mutex<Option<String>>>,
    failed_frame_count: u32,
    device_lost: std::sync::Arc<std::sync::atomic::AtomicBool>,
    surface_configured: bool,
    needs_redraw: bool,
}

impl WgpuRenderer {
    fn resources(&self) -> &WgpuResources {
        self.resources
            .as_ref()
            .expect("GPU resources not available")
    }

    fn resources_mut(&mut self) -> &mut WgpuResources {
        self.resources
            .as_mut()
            .expect("GPU resources not available")
    }

    /// Creates a new WgpuRenderer from raw window handles.
    ///
    /// The `gpu_context` is a shared reference that coordinates GPU context across
    /// multiple windows. The first window to create a renderer will initialize the
    /// context; subsequent windows will share it.
    ///
    /// # Safety
    /// The caller must ensure that the window handle remains valid for the lifetime
    /// of the returned renderer.
    #[cfg(not(target_family = "wasm"))]
    pub fn new<W>(
        gpu_context: GpuContext,
        window: &W,
        config: WgpuSurfaceConfig,
        compositor_gpu: Option<CompositorGpuHint>,
    ) -> anyhow::Result<Self>
    where
        W: HasWindowHandle + HasDisplayHandle + std::fmt::Debug + Send + Sync + Clone + 'static,
    {
        let window_handle = window
            .window_handle()
            .map_err(|e| anyhow::anyhow!("Failed to get window handle: {e}"))?;

        let target = wgpu::SurfaceTargetUnsafe::RawHandle {
            // Fall back to the display handle already provided via InstanceDescriptor::display.
            raw_display_handle: None,
            raw_window_handle: window_handle.as_raw(),
        };

        // Use the existing context's instance if available, otherwise create a new one.
        // The surface must be created with the same instance that will be used for
        // adapter selection, otherwise wgpu will panic.
        let instance = gpu_context
            .borrow()
            .as_ref()
            .map(|ctx| ctx.instance.clone())
            .unwrap_or_else(|| WgpuContext::instance(Box::new(window.clone())));

        // Safety: The caller guarantees that the window handle is valid for the
        // lifetime of this renderer. In practice, the RawWindow struct is created
        // from the native window handles and the surface is dropped before the window.
        let surface = unsafe {
            instance
                .create_surface_unsafe(target)
                .map_err(|e| anyhow::anyhow!("Failed to create surface: {e}"))?
        };

        let mut ctx_ref = gpu_context.borrow_mut();
        let context = match ctx_ref.as_mut() {
            Some(context) => {
                context.check_compatible_with_surface(&surface)?;
                context
            }
            None => ctx_ref.insert(WgpuContext::new(instance, &surface, compositor_gpu)?),
        };

        let atlas = Arc::new(WgpuAtlas::from_context(context));

        Self::new_internal(
            Some(Rc::clone(&gpu_context)),
            context,
            Some(surface),
            config,
            compositor_gpu,
            atlas,
        )
    }

    /// Creates a renderer without a window. Frames are drawn with
    /// [`render_to_pixels`](Self::render_to_pixels) and read back as RGBA, for
    /// hosts that present frames themselves, such as a terminal.
    pub fn new_offscreen(context: &WgpuContext, size: Size<DevicePixels>) -> anyhow::Result<Self> {
        let atlas = Arc::new(WgpuAtlas::from_context(context));
        Self::new_internal(
            None,
            context,
            None,
            WgpuSurfaceConfig {
                size,
                transparent: false,
                preferred_present_mode: None,
            },
            None,
            atlas,
        )
    }

    #[cfg(target_family = "wasm")]
    pub fn new_from_canvas(
        context: &WgpuContext,
        canvas: &web_sys::HtmlCanvasElement,
        config: WgpuSurfaceConfig,
    ) -> anyhow::Result<Self> {
        let surface = context
            .instance
            .create_surface(wgpu::SurfaceTarget::Canvas(canvas.clone()))
            .map_err(|e| anyhow::anyhow!("Failed to create surface: {e}"))?;
        Self::new_from_surface(context, surface, config)
    }

    #[cfg(target_family = "wasm")]
    #[allow(clippy::arc_with_non_send_sync)]
    pub fn new_from_surface(
        context: &WgpuContext,
        surface: wgpu::Surface<'static>,
        config: WgpuSurfaceConfig,
    ) -> anyhow::Result<Self> {
        let atlas = Arc::new(WgpuAtlas::from_context(context));
        Self::new_internal(None, context, Some(surface), config, None, atlas)
    }

    fn new_internal(
        gpu_context: Option<GpuContext>,
        context: &WgpuContext,
        surface: Option<wgpu::Surface<'static>>,
        config: WgpuSurfaceConfig,
        compositor_gpu: Option<CompositorGpuHint>,
        atlas: Arc<WgpuAtlas>,
    ) -> anyhow::Result<Self> {
        let surface_caps = match &surface {
            Some(surface) => surface.get_capabilities(&context.adapter),
            // Offscreen frames are read back as RGBA, the layout image consumers expect.
            None => wgpu::SurfaceCapabilities {
                formats: vec![wgpu::TextureFormat::Rgba8Unorm],
                present_modes: vec![wgpu::PresentMode::Fifo],
                alpha_modes: vec![wgpu::CompositeAlphaMode::Opaque],
                usages: wgpu::TextureUsages::RENDER_ATTACHMENT,
            },
        };
        let preferred_formats = [
            wgpu::TextureFormat::Bgra8Unorm,
            wgpu::TextureFormat::Rgba8Unorm,
        ];
        let surface_format = preferred_formats
            .iter()
            .find(|f| surface_caps.formats.contains(f))
            .copied()
            .or_else(|| surface_caps.formats.iter().find(|f| !f.is_srgb()).copied())
            .or_else(|| surface_caps.formats.first().copied())
            .ok_or_else(|| {
                anyhow::anyhow!(
                    "Surface reports no supported texture formats for adapter {:?}",
                    context.adapter.get_info().name
                )
            })?;

        let pick_alpha_mode =
            |preferences: &[wgpu::CompositeAlphaMode]| -> anyhow::Result<wgpu::CompositeAlphaMode> {
                preferences
                    .iter()
                    .find(|p| surface_caps.alpha_modes.contains(p))
                    .copied()
                    .or_else(|| surface_caps.alpha_modes.first().copied())
                    .ok_or_else(|| {
                        anyhow::anyhow!(
                            "Surface reports no supported alpha modes for adapter {:?}",
                            context.adapter.get_info().name
                        )
                    })
            };

        let transparent_alpha_mode = pick_alpha_mode(&[
            wgpu::CompositeAlphaMode::PreMultiplied,
            wgpu::CompositeAlphaMode::Inherit,
        ])?;

        let opaque_alpha_mode = pick_alpha_mode(&[
            wgpu::CompositeAlphaMode::Opaque,
            wgpu::CompositeAlphaMode::Inherit,
        ])?;

        let alpha_mode = if config.transparent {
            transparent_alpha_mode
        } else {
            opaque_alpha_mode
        };

        let device = Arc::clone(&context.device);
        let max_texture_size = device.limits().max_texture_dimension_2d;

        let requested_width = config.size.width.0 as u32;
        let requested_height = config.size.height.0 as u32;
        let clamped_width = requested_width.min(max_texture_size);
        let clamped_height = requested_height.min(max_texture_size);

        if clamped_width != requested_width || clamped_height != requested_height {
            warn!(
                "Requested surface size ({}, {}) exceeds maximum texture dimension {}. \
                 Clamping to ({}, {}). Window content may not fill the entire window.",
                requested_width, requested_height, max_texture_size, clamped_width, clamped_height
            );
        }

        let surface_config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format: surface_format,
            width: clamped_width.max(1),
            height: clamped_height.max(1),
            present_mode: config
                .preferred_present_mode
                .filter(|mode| surface_caps.present_modes.contains(mode))
                .unwrap_or(wgpu::PresentMode::Fifo),
            desired_maximum_frame_latency: 2,
            alpha_mode,
            view_formats: vec![],
        };
        // Configure the surface immediately. The adapter selection process already validated
        // that this adapter can successfully configure this surface.
        if let Some(surface) = &surface {
            surface.configure(&context.device, &surface_config);
        }

        let queue = Arc::clone(&context.queue);
        let rendering_params = RenderingParameters::new(&context.adapter, surface_format);
        let uses_webgl_instance_data = context.uses_webgl_instance_data();
        let dual_source_blending =
            context.supports_dual_source_blending() && !uses_webgl_instance_data;
        let bind_group_layouts = Self::create_bind_group_layouts(&device, uses_webgl_instance_data);
        let pipelines = Self::create_pipelines(
            &device,
            &bind_group_layouts,
            surface_format,
            alpha_mode,
            rendering_params.path_sample_count,
            dual_source_blending,
            uses_webgl_instance_data,
        );

        let atlas_sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("atlas_sampler"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });

        let filter_sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("filter_sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });

        let surface_sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("surface_sampler"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });

        let surface_uniform_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("surface_uniform_buffer"),
            size: std::mem::size_of::<SurfaceParams>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let uniform_alignment = device.limits().min_uniform_buffer_offset_alignment as u64;
        let globals_size = std::mem::size_of::<GlobalParams>() as u64;
        let gamma_size = std::mem::size_of::<GammaParams>() as u64;
        let path_globals_offset = globals_size.next_multiple_of(uniform_alignment);
        let gamma_offset = (path_globals_offset + globals_size).next_multiple_of(uniform_alignment);

        let globals_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("globals_buffer"),
            size: gamma_offset + gamma_size,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let (
            instance_data,
            instance_data_capacity,
            max_instance_data_size,
            instance_data_alignment,
        ) = if uses_webgl_instance_data {
            let max_texture_dimension = device.limits().max_texture_dimension_2d;
            let max_instance_data_size = (u64::from(max_texture_dimension).pow(2)
                * INSTANCE_TEXTURE_TEXEL_SIZE)
                .min(MAX_INSTANCE_BUFFER_SIZE);
            let initial_capacity = (2 * 1024 * 1024).min(max_instance_data_size);
            let (instance_data, capacity) =
                Self::create_instance_texture(&device, initial_capacity, max_texture_dimension);
            (
                instance_data,
                capacity,
                max_instance_data_size,
                INSTANCE_TEXTURE_TEXEL_SIZE,
            )
        } else {
            // Every frame allocation is exposed as one storage-buffer binding, so
            // its backing buffer must satisfy both the allocation and binding limits.
            let max_buffer_size = device
                .limits()
                .max_buffer_size
                .min(device.limits().max_storage_buffer_binding_size)
                .min(MAX_INSTANCE_BUFFER_SIZE);
            let initial_capacity = (2 * 1024 * 1024).min(max_buffer_size);
            let buffer = device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("instance_buffer"),
                size: initial_capacity,
                usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            });
            (
                InstanceData::Storage(buffer),
                initial_capacity,
                max_buffer_size,
                device.limits().min_storage_buffer_offset_alignment as u64,
            )
        };

        let globals_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("globals_bind_group"),
            layout: &bind_group_layouts.globals,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::Buffer(wgpu::BufferBinding {
                        buffer: &globals_buffer,
                        offset: 0,
                        size: Some(NonZeroU64::new(globals_size).unwrap()),
                    }),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::Buffer(wgpu::BufferBinding {
                        buffer: &globals_buffer,
                        offset: gamma_offset,
                        size: Some(NonZeroU64::new(gamma_size).unwrap()),
                    }),
                },
            ],
        });

        let path_globals_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("path_globals_bind_group"),
            layout: &bind_group_layouts.globals,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::Buffer(wgpu::BufferBinding {
                        buffer: &globals_buffer,
                        offset: path_globals_offset,
                        size: Some(NonZeroU64::new(globals_size).unwrap()),
                    }),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::Buffer(wgpu::BufferBinding {
                        buffer: &globals_buffer,
                        offset: gamma_offset,
                        size: Some(NonZeroU64::new(gamma_size).unwrap()),
                    }),
                },
            ],
        });

        let adapter_info = context.adapter.get_info();

        let last_error: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
        let last_error_clone = Arc::clone(&last_error);
        device.on_uncaptured_error(Arc::new(move |error| {
            let mut guard = last_error_clone.lock().unwrap();
            *guard = Some(error.to_string());
        }));

        let resources = WgpuResources {
            device,
            queue,
            surface,
            readback: None,
            pipelines,
            bind_group_layouts,
            atlas_sampler,
            filter_sampler,
            surface_sampler,
            surface_uniform_buffer,
            globals_buffer,
            globals_bind_group,
            path_globals_bind_group,
            instance_data,
            path_intermediate: None,
            path_msaa: None,
            filter_targets: FilterTargets::default(),
        };

        let frame_size = (surface_config.width, surface_config.height);

        Ok(Self {
            context: gpu_context,
            compositor_gpu,
            resources: Some(resources),
            surface_config,
            atlas,
            path_globals_offset,
            gamma_offset,
            instance_data_capacity,
            max_instance_data_size,
            instance_data_alignment,
            uses_webgl_instance_data,
            frame_time: Instant::now(),
            frame_size,
            rendering_params,
            is_bgr: false,
            dual_source_blending,
            adapter_info,
            transparent_alpha_mode,
            opaque_alpha_mode,
            max_texture_size,
            last_error,
            failed_frame_count: 0,
            device_lost: context.device_lost_flag(),
            surface_configured: true,
            needs_redraw: false,
        })
    }

    fn create_bind_group_layouts(
        device: &wgpu::Device,
        uses_webgl_instance_data: bool,
    ) -> WgpuBindGroupLayouts {
        let globals =
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("globals_layout"),
                entries: &[
                    wgpu::BindGroupLayoutEntry {
                        binding: 0,
                        visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                        ty: wgpu::BindingType::Buffer {
                            ty: wgpu::BufferBindingType::Uniform,
                            has_dynamic_offset: false,
                            min_binding_size: NonZeroU64::new(
                                std::mem::size_of::<GlobalParams>() as u64
                            ),
                        },
                        count: None,
                    },
                    wgpu::BindGroupLayoutEntry {
                        binding: 1,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Buffer {
                            ty: wgpu::BufferBindingType::Uniform,
                            has_dynamic_offset: false,
                            min_binding_size: NonZeroU64::new(
                                std::mem::size_of::<GammaParams>() as u64
                            ),
                        },
                        count: None,
                    },
                ],
            });

        let custom_backdrop_globals =
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("custom_backdrop_globals_layout"),
                entries: &[
                    wgpu::BindGroupLayoutEntry {
                        binding: 0,
                        visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                        ty: wgpu::BindingType::Buffer {
                            ty: wgpu::BufferBindingType::Uniform,
                            has_dynamic_offset: false,
                            min_binding_size: NonZeroU64::new(
                                std::mem::size_of::<GlobalParams>() as u64
                            ),
                        },
                        count: None,
                    },
                    wgpu::BindGroupLayoutEntry {
                        binding: 1,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Texture {
                            sample_type: wgpu::TextureSampleType::Float { filterable: true },
                            view_dimension: wgpu::TextureViewDimension::D2,
                            multisampled: false,
                        },
                        count: None,
                    },
                    wgpu::BindGroupLayoutEntry {
                        binding: 2,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                        count: None,
                    },
                ],
            });

        let instance_data_entry = wgpu::BindGroupLayoutEntry {
            binding: 0,
            visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
            ty: if uses_webgl_instance_data {
                wgpu::BindingType::Texture {
                    sample_type: wgpu::TextureSampleType::Uint,
                    view_dimension: wgpu::TextureViewDimension::D2,
                    multisampled: false,
                }
            } else {
                wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Storage { read_only: true },
                    has_dynamic_offset: false,
                    min_binding_size: None,
                }
            },
            count: None,
        };

        let instances = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("instances_layout"),
            entries: &[instance_data_entry],
        });

        let texture = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("texture_layout"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });

        let surfaces = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("surfaces_layout"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: NonZeroU64::new(
                            std::mem::size_of::<SurfaceParams>() as u64
                        ),
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });

        WgpuBindGroupLayouts {
            globals,
            custom_backdrop_globals,
            instances,
            texture,
            surfaces,
        }
    }

    fn create_instance_texture(
        device: &wgpu::Device,
        requested_capacity: u64,
        max_texture_dimension: u32,
    ) -> (InstanceData, u64) {
        let texel_count = requested_capacity.div_ceil(INSTANCE_TEXTURE_TEXEL_SIZE);
        let width = texel_count.min(u64::from(max_texture_dimension)).max(1) as u32;
        let height = texel_count
            .div_ceil(u64::from(width))
            .min(u64::from(max_texture_dimension))
            .max(1) as u32;
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("instance_texture"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba32Uint,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        let capacity = u64::from(width) * u64::from(height) * INSTANCE_TEXTURE_TEXEL_SIZE;
        (
            InstanceData::Texture {
                texture,
                view,
                width,
                height,
            },
            capacity,
        )
    }

    fn create_pipelines(
        device: &wgpu::Device,
        layouts: &WgpuBindGroupLayouts,
        surface_format: wgpu::TextureFormat,
        alpha_mode: wgpu::CompositeAlphaMode,
        path_sample_count: u32,
        dual_source_blending: bool,
        uses_webgl_instance_data: bool,
    ) -> WgpuPipelines {
        // Diagnostic guard: verify the device actually has
        // DUAL_SOURCE_BLENDING. We have a crash report (ZED-5G1) where a
        // feature mismatch caused a wgpu-hal abort, but we haven't
        // identified the code path that produces the mismatch. This
        // guard prevents the crash and logs more evidence.
        // Remove this check once:
        // a) We find and fix the root cause, or
        // b) There are no reports of this warning appearing for some time.
        let device_has_feature = device
            .features()
            .contains(wgpu::Features::DUAL_SOURCE_BLENDING);
        if dual_source_blending && !device_has_feature {
            log::error!(
                "BUG: dual_source_blending flag is true but device does not \
                 have DUAL_SOURCE_BLENDING enabled (device features: {:?}). \
                 Falling back to mono text rendering. Please report this at \
                 https://github.com/zed-industries/zed/issues",
                device.features(),
            );
        }
        let dual_source_blending =
            dual_source_blending && device_has_feature && !uses_webgl_instance_data;

        let shader_source = if uses_webgl_instance_data {
            WEBGL_SHADERS
        } else {
            STORAGE_BUFFER_SHADERS
        };
        let shader_module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("gpui_shaders"),
            source: wgpu::ShaderSource::Wgsl(shader_source.into()),
        });

        let subpixel_shader_module = if dual_source_blending {
            Some(device.create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("gpui_subpixel_shaders"),
                source: wgpu::ShaderSource::Wgsl(SUBPIXEL_SHADERS.into()),
            }))
        } else {
            None
        };

        let blend_mode = match alpha_mode {
            wgpu::CompositeAlphaMode::PreMultiplied => {
                wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING
            }
            _ => wgpu::BlendState::ALPHA_BLENDING,
        };

        let color_target = wgpu::ColorTargetState {
            format: surface_format,
            blend: Some(blend_mode),
            write_mask: wgpu::ColorWrites::ALL,
        };

        // Offscreen layers and the frame itself are drawn onto a transparent clear, so what they
        // hold is already premultiplied however the surface wants its colours.
        let premultiplied_target = wgpu::ColorTargetState {
            format: surface_format,
            blend: Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING),
            write_mask: wgpu::ColorWrites::ALL,
        };

        let create_pipeline = |name: &str,
                               vs_entry: &str,
                               fs_entry: &str,
                               globals_layout: &wgpu::BindGroupLayout,
                               data_layout: &wgpu::BindGroupLayout,
                               texture_layout: Option<&wgpu::BindGroupLayout>,
                               topology: wgpu::PrimitiveTopology,
                               color_targets: &[Option<wgpu::ColorTargetState>],
                               sample_count: u32,
                               module: &wgpu::ShaderModule| {
            let mut bind_group_layouts = vec![Some(globals_layout), Some(data_layout)];
            bind_group_layouts.extend(texture_layout.map(Some));
            let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some(&format!("{name}_layout")),
                bind_group_layouts: &bind_group_layouts,
                immediate_size: 0,
            });

            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some(name),
                layout: Some(&pipeline_layout),
                vertex: wgpu::VertexState {
                    module,
                    entry_point: Some(vs_entry),
                    buffers: &[],
                    compilation_options: wgpu::PipelineCompilationOptions::default(),
                },
                fragment: Some(wgpu::FragmentState {
                    module,
                    entry_point: Some(fs_entry),
                    targets: color_targets,
                    compilation_options: wgpu::PipelineCompilationOptions::default(),
                }),
                primitive: wgpu::PrimitiveState {
                    topology,
                    strip_index_format: None,
                    front_face: wgpu::FrontFace::Ccw,
                    cull_mode: None,
                    polygon_mode: wgpu::PolygonMode::Fill,
                    unclipped_depth: false,
                    conservative: false,
                },
                depth_stencil: None,
                multisample: wgpu::MultisampleState {
                    count: sample_count,
                    mask: !0,
                    alpha_to_coverage_enabled: false,
                },
                multiview_mask: None,
                cache: None,
            })
        };

        // A backdrop mixes the blurred copy into what it covers instead of laying it over:
        // the punch pass scales the destination by `1 - k` and the draw over it adds
        // `blurred * k`.
        let backdrop_punch_target = wgpu::ColorTargetState {
            format: surface_format,
            blend: Some(wgpu::BlendState {
                color: wgpu::BlendComponent {
                    src_factor: wgpu::BlendFactor::Zero,
                    dst_factor: wgpu::BlendFactor::OneMinusSrcAlpha,
                    operation: wgpu::BlendOperation::Add,
                },
                alpha: wgpu::BlendComponent {
                    src_factor: wgpu::BlendFactor::Zero,
                    dst_factor: wgpu::BlendFactor::OneMinusSrcAlpha,
                    operation: wgpu::BlendOperation::Add,
                },
            }),
            write_mask: wgpu::ColorWrites::ALL,
        };

        let backdrop_target = wgpu::ColorTargetState {
            format: surface_format,
            blend: Some(wgpu::BlendState {
                color: wgpu::BlendComponent {
                    src_factor: wgpu::BlendFactor::One,
                    dst_factor: wgpu::BlendFactor::One,
                    operation: wgpu::BlendOperation::Add,
                },
                alpha: wgpu::BlendComponent {
                    src_factor: wgpu::BlendFactor::One,
                    dst_factor: wgpu::BlendFactor::One,
                    operation: wgpu::BlendOperation::Add,
                },
            }),
            write_mask: wgpu::ColorWrites::ALL,
        };

        let backdrop_punch = create_pipeline(
            "backdrop_punch",
            "vs_backdrop",
            "fs_backdrop_punch",
            &layouts.globals,
            &layouts.instances,
            Some(&layouts.texture),
            wgpu::PrimitiveTopology::TriangleStrip,
            &[Some(backdrop_punch_target)],
            1,
            &shader_module,
        );

        let backdrops = create_pipeline(
            "backdrops",
            "vs_backdrop",
            "fs_backdrop",
            &layouts.globals,
            &layouts.instances,
            Some(&layouts.texture),
            wgpu::PrimitiveTopology::TriangleStrip,
            &[Some(backdrop_target)],
            1,
            &shader_module,
        );

        let opaque_target = wgpu::ColorTargetState {
            format: surface_format,
            blend: None,
            write_mask: wgpu::ColorWrites::ALL,
        };

        let gaussian = create_pipeline(
            "gaussian",
            "vs_blur",
            "fs_gaussian",
            &layouts.globals,
            &layouts.instances,
            Some(&layouts.texture),
            wgpu::PrimitiveTopology::TriangleStrip,
            &[Some(opaque_target.clone())],
            1,
            &shader_module,
        );

        let kawase_down = create_pipeline(
            "kawase_down",
            "vs_blur",
            "fs_kawase_down",
            &layouts.globals,
            &layouts.instances,
            Some(&layouts.texture),
            wgpu::PrimitiveTopology::TriangleStrip,
            &[Some(opaque_target.clone())],
            1,
            &shader_module,
        );

        let kawase_up = create_pipeline(
            "kawase_up",
            "vs_blur",
            "fs_kawase_up",
            &layouts.globals,
            &layouts.instances,
            Some(&layouts.texture),
            wgpu::PrimitiveTopology::TriangleStrip,
            &[Some(opaque_target.clone())],
            1,
            &shader_module,
        );

        let blit = create_pipeline(
            "blit",
            "vs_blur",
            "fs_blit",
            &layouts.globals,
            &layouts.instances,
            Some(&layouts.texture),
            wgpu::PrimitiveTopology::TriangleStrip,
            &[Some(opaque_target)],
            1,
            &shader_module,
        );

        let composite = create_pipeline(
            "composite",
            "vs_blur",
            "fs_mask",
            &layouts.globals,
            &layouts.instances,
            Some(&layouts.texture),
            wgpu::PrimitiveTopology::TriangleStrip,
            &[Some(premultiplied_target.clone())],
            1,
            &shader_module,
        );

        let masked = create_pipeline(
            "masked",
            "vs_blur",
            "fs_mask",
            &layouts.globals,
            &layouts.instances,
            Some(&layouts.texture),
            wgpu::PrimitiveTopology::TriangleStrip,
            &[Some(premultiplied_target.clone())],
            1,
            &shader_module,
        );

        let blurred = create_pipeline(
            "blurred",
            "vs_blur",
            "fs_mask_gaussian",
            &layouts.globals,
            &layouts.instances,
            Some(&layouts.texture),
            wgpu::PrimitiveTopology::TriangleStrip,
            &[Some(premultiplied_target)],
            1,
            &shader_module,
        );

        let quads = create_pipeline(
            "quads",
            "vs_quad",
            "fs_quad",
            &layouts.globals,
            &layouts.instances,
            None,
            wgpu::PrimitiveTopology::TriangleStrip,
            &[Some(color_target.clone())],
            1,
            &shader_module,
        );

        let shadows = create_pipeline(
            "shadows",
            "vs_shadow",
            "fs_shadow",
            &layouts.globals,
            &layouts.instances,
            None,
            wgpu::PrimitiveTopology::TriangleStrip,
            &[Some(color_target.clone())],
            1,
            &shader_module,
        );

        let path_rasterization = create_pipeline(
            "path_rasterization",
            "vs_path_rasterization",
            "fs_path_rasterization",
            &layouts.globals,
            &layouts.instances,
            None,
            wgpu::PrimitiveTopology::TriangleList,
            &[Some(wgpu::ColorTargetState {
                format: surface_format,
                blend: Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING),
                write_mask: wgpu::ColorWrites::ALL,
            })],
            path_sample_count,
            &shader_module,
        );

        let paths = create_pipeline(
            "paths",
            "vs_path",
            "fs_path",
            &layouts.globals,
            &layouts.instances,
            Some(&layouts.texture),
            wgpu::PrimitiveTopology::TriangleStrip,
            &[Some(wgpu::ColorTargetState {
                format: surface_format,
                blend: Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING),
                write_mask: wgpu::ColorWrites::ALL,
            })],
            1,
            &shader_module,
        );

        let underlines = create_pipeline(
            "underlines",
            "vs_underline",
            "fs_underline",
            &layouts.globals,
            &layouts.instances,
            None,
            wgpu::PrimitiveTopology::TriangleStrip,
            &[Some(color_target.clone())],
            1,
            &shader_module,
        );

        let mono_sprites = create_pipeline(
            "mono_sprites",
            "vs_mono_sprite",
            "fs_mono_sprite",
            &layouts.globals,
            &layouts.instances,
            Some(&layouts.texture),
            wgpu::PrimitiveTopology::TriangleStrip,
            &[Some(color_target.clone())],
            1,
            &shader_module,
        );

        let subpixel_sprites = if let Some(subpixel_module) = &subpixel_shader_module {
            let subpixel_blend = wgpu::BlendState {
                color: wgpu::BlendComponent {
                    src_factor: wgpu::BlendFactor::Src1,
                    dst_factor: wgpu::BlendFactor::OneMinusSrc1,
                    operation: wgpu::BlendOperation::Add,
                },
                alpha: wgpu::BlendComponent {
                    src_factor: wgpu::BlendFactor::One,
                    dst_factor: wgpu::BlendFactor::OneMinusSrcAlpha,
                    operation: wgpu::BlendOperation::Add,
                },
            };

            Some(create_pipeline(
                "subpixel_sprites",
                "vs_subpixel_sprite",
                "fs_subpixel_sprite",
                &layouts.globals,
                &layouts.instances,
                Some(&layouts.texture),
                wgpu::PrimitiveTopology::TriangleStrip,
                &[Some(wgpu::ColorTargetState {
                    format: surface_format,
                    blend: Some(subpixel_blend),
                    write_mask: wgpu::ColorWrites::COLOR,
                })],
                1,
                subpixel_module,
            ))
        } else {
            None
        };

        let subpixel_sprites_layered = subpixel_shader_module.as_ref().map(|subpixel_module| {
            create_pipeline(
                "subpixel_sprites_layered",
                "vs_subpixel_sprite",
                "fs_subpixel_sprite_layered",
                &layouts.globals,
                &layouts.instances,
                Some(&layouts.texture),
                wgpu::PrimitiveTopology::TriangleStrip,
                &[Some(color_target.clone())],
                1,
                subpixel_module,
            )
        });

        let poly_sprites = create_pipeline(
            "poly_sprites",
            "vs_poly_sprite",
            "fs_poly_sprite",
            &layouts.globals,
            &layouts.instances,
            Some(&layouts.texture),
            wgpu::PrimitiveTopology::TriangleStrip,
            &[Some(color_target.clone())],
            1,
            &shader_module,
        );

        let surfaces = create_pipeline(
            "surfaces",
            "vs_surface",
            "fs_surface",
            &layouts.globals,
            &layouts.surfaces,
            None,
            wgpu::PrimitiveTopology::TriangleStrip,
            &[Some(color_target.clone())],
            1,
            &shader_module,
        );

        WgpuPipelines {
            backdrops,
            backdrop_punch,
            gaussian,
            kawase_down,
            kawase_up,
            blit,
            composite,
            masked,
            blurred,
            quads,
            shadows,
            path_rasterization,
            paths,
            underlines,
            mono_sprites,
            subpixel_sprites,
            subpixel_sprites_layered,
            poly_sprites,
            surfaces,
            custom_target: color_target,
            custom: FxHashMap::default(),
        }
    }

    fn resume_pass<'a>(
        encoder: &'a mut wgpu::CommandEncoder,
        label: &str,
        view: &wgpu::TextureView,
        load: wgpu::LoadOp<wgpu::Color>,
    ) -> wgpu::RenderPass<'a> {
        encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some(label),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view,
                resolve_target: None,
                ops: wgpu::Operations {
                    load,
                    store: wgpu::StoreOp::Store,
                },
                depth_slice: None,
            })],
            depth_stencil_attachment: None,
            ..Default::default()
        })
    }

    fn scissor(&self, bounds: Bounds<ScaledPixels>, shrink: u32) -> [u32; 4] {
        let shrink = shrink as f32;
        let width = (self.frame_size.0 as f32 / shrink).floor();
        let height = (self.frame_size.1 as f32 / shrink).floor();
        let left = (bounds.origin.x.0 / shrink).floor().clamp(0., width);
        let top = (bounds.origin.y.0 / shrink).floor().clamp(0., height);
        let right = ((bounds.origin.x.0 + bounds.size.width.0) / shrink)
            .ceil()
            .clamp(left, width);
        let bottom = ((bounds.origin.y.0 + bounds.size.height.0) / shrink)
            .ceil()
            .clamp(top, height);

        [
            left as u32,
            top as u32,
            (right - left) as u32,
            (bottom - top) as u32,
        ]
    }

    fn composite_layer(
        &self,
        source: &wgpu::TextureView,
        bounds: Bounds<ScaledPixels>,
        composite: Composite,
        instances: &InstanceBinding,
        pass: &mut wgpu::RenderPass<'_>,
    ) {
        let width = self.frame_size.0 as f32;
        let height = self.frame_size.1 as f32;
        let left = bounds.origin.x.0.max(0.).min(width);
        let top = bounds.origin.y.0.max(0.).min(height);
        let right = (bounds.origin.x.0 + bounds.size.width.0).max(0.).min(width);
        let bottom = (bounds.origin.y.0 + bounds.size.height.0)
            .max(0.)
            .min(height);
        if right <= left || bottom <= top {
            return;
        }

        let texture = self.create_filter_texture_bind_group("layer_bind_group", source);
        let resources = self.resources();
        pass.set_pipeline(match composite {
            Composite::Plain => &resources.pipelines.composite,
            Composite::Masked => &resources.pipelines.masked,
            Composite::Blurred => &resources.pipelines.blurred,
        });
        pass.set_bind_group(0, &resources.globals_bind_group, &[]);
        pass.set_bind_group(1, &instances.bind_group, &[]);
        pass.set_bind_group(2, &texture, &[]);
        pass.set_scissor_rect(
            left as u32,
            top as u32,
            (right - left) as u32,
            (bottom - top) as u32,
        );
        pass.draw(0..4, instances.first_instance..instances.first_instance + 1);
        pass.set_scissor_rect(0, 0, self.frame_size.0, self.frame_size.1);
    }

    fn backdrop_source(
        &mut self,
        encoder: &mut wgpu::CommandEncoder,
        frame: &wgpu::TextureView,
        depth: usize,
        clip: Option<Bounds<ScaledPixels>>,
        instance_offset: &mut u64,
    ) -> Result<wgpu::TextureView> {
        if depth == 0 {
            return Ok(frame.clone());
        }
        let target = self.filter_view(FilterTarget::Backdrop);
        let bounds = [0., 0., self.frame_size.0 as f32, self.frame_size.1 as f32];
        let params = self.write_instance_binding(
            "backdrop_source_params",
            instance_offset,
            &[MaskParams {
                source_bounds: bounds,
                fade_bounds: bounds,
                inv_matrix: [1., 0., 0., 1.],
                fwd_matrix: [1., 0., 0., 1.],
                transform_flags: 1,
                ..Default::default()
            }],
        )?;
        let mut sources = vec![frame.clone()];
        sources.extend((0..depth).map(|level| self.filter_view(FilterTarget::Layer(level))));
        let clip = clip.unwrap_or_else(|| {
            Bounds::new(
                point(ScaledPixels(0.), ScaledPixels(0.)),
                size(ScaledPixels(bounds[2]), ScaledPixels(bounds[3])),
            )
        });
        let mut pass = Self::resume_pass(
            encoder,
            "backdrop_source",
            &target,
            wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
        );
        for source in sources {
            self.composite_layer(&source, clip, Composite::Plain, &params, &mut pass);
        }
        drop(pass);
        Ok(target)
    }

    fn blur_source(
        &mut self,
        encoder: &mut wgpu::CommandEncoder,
        source: &wgpu::TextureView,
        spare: bool,
        sigma: f32,
        clip: Option<Bounds<ScaledPixels>>,
        instance_offset: &mut u64,
    ) -> Result<wgpu::TextureView> {
        match BlurPasses::for_sigma(sigma) {
            BlurPasses::Gaussian(sigma) => {
                self.gaussian_blur(encoder, source, spare, sigma, clip, instance_offset)
            }
            BlurPasses::Kawase(kawase) => {
                self.kawase_blur(encoder, source, kawase, clip, instance_offset)
            }
        }
    }

    fn gaussian_blur(
        &mut self,
        encoder: &mut wgpu::CommandEncoder,
        source: &wgpu::TextureView,
        spare: bool,
        sigma: f32,
        clip: Option<Bounds<ScaledPixels>>,
        instance_offset: &mut u64,
    ) -> Result<wgpu::TextureView> {
        let scratch = self.gaussian_across(encoder, source, sigma, clip, instance_offset)?;
        let down = self.write_instance_binding(
            "gaussian_down_bind_group",
            instance_offset,
            &[BlurParams {
                direction: [0., 1.],
                radius: sigma,
                pad: 0,
            }],
        )?;
        let settled = match spare {
            true => source.clone(),
            false => self.filter_view(FilterTarget::Level(0)),
        };
        let gaussian = self.resources().pipelines.gaussian.clone();
        let within = clip.map(|clip| self.scissor(clip.dilate(ScaledPixels(1.)), 1));
        self.fullscreen_pass(
            encoder,
            "gaussian_down",
            &gaussian,
            &scratch,
            &settled,
            &down,
            within,
        );
        Ok(settled)
    }

    fn gaussian_across(
        &mut self,
        encoder: &mut wgpu::CommandEncoder,
        source: &wgpu::TextureView,
        sigma: f32,
        clip: Option<Bounds<ScaledPixels>>,
        instance_offset: &mut u64,
    ) -> Result<wgpu::TextureView> {
        let across = self.write_instance_binding(
            "gaussian_across_bind_group",
            instance_offset,
            &[BlurParams {
                direction: [1., 0.],
                radius: sigma,
                pad: 0,
            }],
        )?;
        let scratch = self.filter_view(FilterTarget::Scratch);
        let gaussian = self.resources().pipelines.gaussian.clone();
        let reach = (sigma * GAUSSIAN_REACH).ceil() + 1.;
        let within = clip.map(|clip| self.scissor(clip.dilate(ScaledPixels(reach)), 1));
        self.fullscreen_pass(
            encoder,
            "gaussian_across",
            &gaussian,
            source,
            &scratch,
            &across,
            within,
        );
        Ok(scratch)
    }

    fn kawase_blur(
        &mut self,
        encoder: &mut wgpu::CommandEncoder,
        source: &wgpu::TextureView,
        kawase: Kawase,
        clip: Option<Bounds<ScaledPixels>>,
        instance_offset: &mut u64,
    ) -> Result<wgpu::TextureView> {
        let params = self.write_instance_binding(
            "kawase_bind_group",
            instance_offset,
            &[BlurParams {
                direction: [0., 0.],
                radius: kawase.offset,
                pad: 0,
            }],
        )?;
        let levels: Vec<wgpu::TextureView> = (1..=kawase.levels)
            .map(|level| self.filter_view(FilterTarget::Level(level)))
            .collect();
        let down = self.resources().pipelines.kawase_down.clone();
        let up = self.resources().pipelines.kawase_up.clone();

        let reach = kawase.reach();
        let within = |level: usize| {
            let shrink = 1u32 << level;
            clip.map(|clip| self.scissor(clip.dilate(ScaledPixels(reach + shrink as f32)), shrink))
        };

        let mut from = source;
        for (level, to) in (1..).zip(&levels) {
            self.fullscreen_pass(
                encoder,
                "kawase_down",
                &down,
                from,
                to,
                &params,
                within(level),
            );
            from = to;
        }
        let settled = &levels[kawase.settled - 1];
        self.fullscreen_pass(
            encoder,
            "kawase_up",
            &up,
            from,
            settled,
            &params,
            within(kawase.settled),
        );
        Ok(settled.clone())
    }

    fn fullscreen_pass(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        label: &str,
        pipeline: &wgpu::RenderPipeline,
        source: &wgpu::TextureView,
        target: &wgpu::TextureView,
        instances: &InstanceBinding,
        within: Option<[u32; 4]>,
    ) {
        let texture = self.create_filter_texture_bind_group("backdrop_texture_bind_group", source);
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some(label),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: target,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Load,
                    store: wgpu::StoreOp::Store,
                },
                depth_slice: None,
            })],
            depth_stencil_attachment: None,
            ..Default::default()
        });

        pass.set_pipeline(pipeline);
        pass.set_bind_group(0, &self.resources().globals_bind_group, &[]);
        pass.set_bind_group(1, &instances.bind_group, &[]);
        pass.set_bind_group(2, &texture, &[]);
        if let Some([left, top, width, height]) = within {
            pass.set_scissor_rect(left, top, width, height);
        }
        pass.draw(0..4, instances.first_instance..instances.first_instance + 1);
    }

    fn draw_backdrops(
        &self,
        binding: &InstanceBinding,
        blurred: &wgpu::TextureView,
        range: Range<u32>,
        pass: &mut wgpu::RenderPass<'_>,
    ) {
        if range.is_empty() {
            return;
        }
        let texture = self.create_filter_texture_bind_group("backdrop_blurred_bind_group", blurred);
        let instances = binding.first_instance + range.start..binding.first_instance + range.end;
        pass.set_bind_group(0, &self.resources().globals_bind_group, &[]);
        pass.set_bind_group(1, &binding.bind_group, &[]);
        pass.set_bind_group(2, &texture, &[]);
        pass.set_pipeline(&self.resources().pipelines.backdrop_punch);
        pass.draw(0..4, instances.clone());
        pass.set_pipeline(&self.resources().pipelines.backdrops);
        pass.draw(0..4, instances);
    }

    fn filter_view(&mut self, target: FilterTarget) -> wgpu::TextureView {
        let format = self.surface_config.format;
        let size = (
            (self.frame_size.0 / target.shrink()).max(1),
            (self.frame_size.1 / target.shrink()).max(1),
        );
        let now = self.frame_time;
        let resources = self.resources_mut();
        let device = &resources.device;
        resources
            .filter_targets
            .slot(target)
            .get_or_insert_with(|| {
                Scratch::new(
                    device,
                    &target.label(),
                    format,
                    size,
                    1,
                    wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
                    now,
                )
            })
            .touch(now)
    }

    fn path_views(&mut self) -> (wgpu::TextureView, Option<wgpu::TextureView>) {
        let format = self.surface_config.format;
        let size = (self.frame_size.0.max(1), self.frame_size.1.max(1));
        let sample_count = self.rendering_params.path_sample_count;
        let now = self.frame_time;
        let resources = self.resources_mut();
        let device = &resources.device;
        let intermediate = resources
            .path_intermediate
            .get_or_insert_with(|| {
                Scratch::new(
                    device,
                    "path_intermediate",
                    format,
                    size,
                    1,
                    wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
                    now,
                )
            })
            .touch(now);
        let msaa = (sample_count > 1).then(|| {
            resources
                .path_msaa
                .get_or_insert_with(|| {
                    Scratch::new(
                        device,
                        "path_msaa",
                        format,
                        size,
                        sample_count,
                        wgpu::TextureUsages::RENDER_ATTACHMENT,
                        now,
                    )
                })
                .touch(now)
        });
        (intermediate, msaa)
    }

    pub fn update_drawable_size(&mut self, size: Size<DevicePixels>) {
        let width = size.width.0 as u32;
        let height = size.height.0 as u32;

        if width != self.surface_config.width || height != self.surface_config.height {
            let clamped_width = width.min(self.max_texture_size);
            let clamped_height = height.min(self.max_texture_size);

            if clamped_width != width || clamped_height != height {
                warn!(
                    "Requested surface size ({}, {}) exceeds maximum texture dimension {}. \
                     Clamping to ({}, {}). Window content may not fill the entire window.",
                    width, height, self.max_texture_size, clamped_width, clamped_height
                );
            }

            self.surface_config.width = clamped_width.max(1);
            self.surface_config.height = clamped_height.max(1);
            self.frame_size = (self.surface_config.width, self.surface_config.height);
            let surface_config = self.surface_config.clone();

            let Some(resources) = self.resources.as_mut() else {
                return;
            };

            // Wait for any in-flight GPU work to complete before destroying textures
            if let Err(e) = resources.device.poll(wgpu::PollType::Wait {
                submission_index: None,
                timeout: None,
            }) {
                warn!("Failed to poll device during resize: {e:?}");
            }

            resources.invalidate_intermediate_textures();

            if let Some(surface) = &resources.surface {
                surface.configure(&resources.device, &surface_config);
            }
        }
    }

    pub fn set_subpixel_layout(&mut self, is_bgr: bool) {
        self.is_bgr = is_bgr;
    }

    pub fn update_transparency(&mut self, transparent: bool) {
        let new_alpha_mode = if transparent {
            self.transparent_alpha_mode
        } else {
            self.opaque_alpha_mode
        };

        if new_alpha_mode != self.surface_config.alpha_mode {
            self.surface_config.alpha_mode = new_alpha_mode;
            let surface_config = self.surface_config.clone();
            let path_sample_count = self.rendering_params.path_sample_count;
            let dual_source_blending = self.dual_source_blending;
            let uses_webgl_instance_data = self.uses_webgl_instance_data;
            let Some(resources) = self.resources.as_mut() else {
                return;
            };
            if let Some(surface) = &resources.surface {
                surface.configure(&resources.device, &surface_config);
            }
            resources.pipelines = Self::create_pipelines(
                &resources.device,
                &resources.bind_group_layouts,
                surface_config.format,
                surface_config.alpha_mode,
                path_sample_count,
                dual_source_blending,
                uses_webgl_instance_data,
            );
        }
    }

    #[allow(dead_code)]
    pub fn viewport_size(&self) -> Size<DevicePixels> {
        Size {
            width: DevicePixels(self.surface_config.width as i32),
            height: DevicePixels(self.surface_config.height as i32),
        }
    }

    pub fn sprite_atlas(&self) -> &Arc<WgpuAtlas> {
        &self.atlas
    }

    pub fn supports_dual_source_blending(&self) -> bool {
        self.dual_source_blending
    }

    pub fn gpu_specs(&self) -> GpuSpecs {
        GpuSpecs {
            is_software_emulated: self.adapter_info.device_type == wgpu::DeviceType::Cpu,
            device_name: self.adapter_info.name.clone(),
            driver_name: self.adapter_info.driver.clone(),
            driver_info: self.adapter_info.driver_info.clone(),
        }
    }

    pub fn gpu_context(&self) -> (Arc<wgpu::Device>, Arc<wgpu::Queue>) {
        let resources = self.resources();
        (resources.device.clone(), resources.queue.clone())
    }

    pub fn max_texture_size(&self) -> u32 {
        self.max_texture_size
    }

    pub fn draw(&mut self, scene: &Scene) -> bool {
        #[cfg(target_family = "wasm")]
        if self.device_lost() {
            if self.surface_configured {
                log::error!(
                    "Browser graphics context was lost; rendering has stopped. Reload the page to recover."
                );
                self.surface_configured = false;
            }
            return false;
        }

        // Bail out early if the surface has been unconfigured (e.g. during
        // Android background/rotation transitions).  Attempting to acquire
        // a texture from an unconfigured surface can block indefinitely on
        // some drivers (Adreno).
        if !self.surface_configured {
            return false;
        }

        let last_error = self.last_error.lock().unwrap().take();
        if let Some(error) = last_error {
            self.failed_frame_count += 1;
            log::error!(
                "GPU error during frame (failure {} of 10): {error}",
                self.failed_frame_count
            );

            // TBD. Does retrying more actually help?
            if self.failed_frame_count > 10 {
                panic!("Too many consecutive GPU errors. Last error: {error}");
            } else if self.failed_frame_count > 5 {
                if let Some(res) = self.resources.as_mut() {
                    res.invalidate_intermediate_textures();
                }
                self.atlas.clear();
                self.needs_redraw = true;
                self.failed_frame_count = 0;
                return false;
            }
        } else {
            self.failed_frame_count = 0;
        }

        self.atlas.before_frame();

        let Some(surface) = self.resources().surface.as_ref() else {
            log::error!("draw() called on an offscreen renderer; use render_to_pixels()");
            return false;
        };
        let frame = match surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(frame) => frame,
            wgpu::CurrentSurfaceTexture::Suboptimal(frame) => {
                // Textures must be destroyed before the surface can be reconfigured.
                drop(frame);
                surface.configure(&self.resources().device, &self.surface_config);
                return false;
            }
            wgpu::CurrentSurfaceTexture::Lost | wgpu::CurrentSurfaceTexture::Outdated => {
                surface.configure(&self.resources().device, &self.surface_config);
                return false;
            }
            wgpu::CurrentSurfaceTexture::Timeout | wgpu::CurrentSurfaceTexture::Occluded => {
                return false;
            }
            wgpu::CurrentSurfaceTexture::Validation => {
                *self.last_error.lock().unwrap() =
                    Some("Surface texture validation error".to_string());
                return false;
            }
        };

        // Now that we know the surface is healthy, sync frame dimensions and timestamp.
        let frame_size = (frame.texture.width().max(1), frame.texture.height().max(1));
        if frame_size != self.frame_size {
            self.resources_mut().invalidate_intermediate_textures();
            self.frame_size = frame_size;
        }
        self.frame_time = Instant::now();

        let frame_view = frame
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());

        self.write_globals();

        if let Err(error) = self.record_frame(scene, &frame_view) {
            log::error!("{error:#}");
            self.resources().queue.submit(std::iter::empty());
            return false;
        }

        frame.present();
        true
    }

    fn write_globals(&self) {
        let gamma_params = GammaParams {
            gamma_ratios: self.rendering_params.gamma_ratios,
            grayscale_enhanced_contrast: self.rendering_params.grayscale_enhanced_contrast,
            subpixel_enhanced_contrast: self.rendering_params.subpixel_enhanced_contrast,
            is_bgr: self.is_bgr as u32,
            _pad: 0,
        };

        let globals = GlobalParams {
            viewport_size: [self.frame_size.0 as f32, self.frame_size.1 as f32],
            premultiplied_alpha: if self.surface_config.alpha_mode
                == wgpu::CompositeAlphaMode::PreMultiplied
            {
                1
            } else {
                0
            },
            pad: 0,
        };

        let path_globals = GlobalParams {
            premultiplied_alpha: 0,
            ..globals
        };

        {
            let resources = self.resources();
            resources.queue.write_buffer(
                &resources.globals_buffer,
                0,
                bytemuck::bytes_of(&globals),
            );
            resources.queue.write_buffer(
                &resources.globals_buffer,
                self.path_globals_offset,
                bytemuck::bytes_of(&path_globals),
            );
            resources.queue.write_buffer(
                &resources.globals_buffer,
                self.gamma_offset,
                bytemuck::bytes_of(&gamma_params),
            );
        }
    }

    /// Renders `scene` offscreen and copies it into `pixels` as tightly packed
    /// RGBA rows. `pixels` must hold `width * height * 4` bytes. Blocks until
    /// the GPU finished, so the caller can hand the pixels on right away.
    pub fn render_to_pixels(
        &mut self,
        scene: &Scene,
        size: Size<DevicePixels>,
        pixels: &mut [u8],
    ) -> Result<()> {
        anyhow::ensure!(
            self.resources().surface.is_none(),
            "render_to_pixels needs a renderer from new_offscreen"
        );
        anyhow::ensure!(!self.device_lost(), "the GPU device was lost");
        let width = (size.width.0.max(1) as u32).min(self.max_texture_size);
        let height = (size.height.0.max(1) as u32).min(self.max_texture_size);
        let unpadded_bytes_per_row = width * 4;
        anyhow::ensure!(
            pixels.len() == unpadded_bytes_per_row as usize * height as usize,
            "pixel buffer does not match {width}x{height}"
        );

        self.update_drawable_size(size);
        self.frame_size = (width, height);
        self.frame_time = Instant::now();
        self.atlas.before_frame();
        self.ensure_readback(width, height);
        self.write_globals();

        let view = self
            .resources()
            .readback
            .as_ref()
            .map(|readback| readback.view.clone())
            .context("readback target was just created")?;
        self.record_frame(scene, &view)?;

        let resources = self.resources();
        let readback = resources
            .readback
            .as_ref()
            .context("readback target was just created")?;
        let mut encoder =
            resources
                .device
                .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                    label: Some("readback_encoder"),
                });
        encoder.copy_texture_to_buffer(
            readback.texture.as_image_copy(),
            wgpu::TexelCopyBufferInfo {
                buffer: &readback.buffer,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(readback.padded_bytes_per_row),
                    rows_per_image: Some(height),
                },
            },
            wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
        );
        let submission = resources.queue.submit(std::iter::once(encoder.finish()));

        let slice = readback.buffer.slice(..);
        let (sender, receiver) = std::sync::mpsc::channel();
        slice.map_async(wgpu::MapMode::Read, move |result| {
            sender.send(result).ok();
        });
        resources
            .device
            .poll(wgpu::PollType::Wait {
                submission_index: Some(submission),
                timeout: None,
            })
            .map_err(|error| anyhow::anyhow!("waiting for the GPU: {error:?}"))?;
        receiver
            .recv()
            .context("the readback map callback never ran")?
            .map_err(|error| anyhow::anyhow!("mapping the readback buffer: {error}"))?;

        {
            let mapped = slice.get_mapped_range();
            let padded = readback.padded_bytes_per_row as usize;
            let unpadded = unpadded_bytes_per_row as usize;
            for (source, target) in mapped
                .chunks_exact(padded)
                .zip(pixels.chunks_exact_mut(unpadded))
            {
                target.copy_from_slice(&source[..unpadded]);
            }
        }
        readback.buffer.unmap();

        if let Some(error) = self.last_error.lock().unwrap().take() {
            anyhow::bail!("GPU error during offscreen frame: {error}");
        }
        Ok(())
    }

    fn ensure_readback(&mut self, width: u32, height: u32) {
        let format = self.surface_config.format;
        let resources = self.resources_mut();
        if resources
            .readback
            .as_ref()
            .is_some_and(|readback| readback.width == width && readback.height == height)
        {
            return;
        }
        let texture = resources.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("readback_texture"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        let padded_bytes_per_row = (width * 4).next_multiple_of(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT);
        let buffer = resources.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("readback_buffer"),
            size: u64::from(padded_bytes_per_row) * u64::from(height),
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        resources.readback = Some(Readback {
            texture,
            view,
            buffer,
            width,
            height,
            padded_bytes_per_row,
        });
    }

    fn record_frame(&mut self, scene: &Scene, frame_view: &wgpu::TextureView) -> Result<()> {
        let mut instance_offset = 0;
        let has_backdrops = scene.has_backdrops()
            || scene.shaders.iter().any(|shader| {
                gpui::shader_program(shader.shader).is_some_and(|program| program.samples_backdrop)
            });
        let filtered =
            (has_backdrops || !scene.effects.is_empty()) && !self.uses_webgl_instance_data;
        let instance_bindings = self
            .write_instances(scene, &mut instance_offset)
            .with_context(|| {
                format!(
                    "scene too large: {} paths, {} shadows, {} quads, {} shaders, {} underlines, {} monochrome sprites, {} subpixel sprites, {} polychrome sprites",
                    scene.paths.len(),
                    scene.shadows.len(),
                    scene.quads.len(),
                    scene.shaders.len(),
                    scene.underlines.len(),
                    scene.monochrome_sprites.len(),
                    scene.subpixel_sprites.len(),
                    scene.polychrome_sprites.len(),
                )
            })?;

        let mut encoder =
            self.resources()
                .device
                .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                    label: Some("main_encoder"),
                });

        // Layers composite into whatever they are drawn over, so only a backdrop or
        // backdrop-sampling custom shader routes the main frame through an offscreen target.
        let mirrored = filtered && has_backdrops;
        let main_view = match mirrored {
            true => self.filter_view(FilterTarget::Frame),
            false => frame_view.clone(),
        };

        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("main_pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &main_view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                        store: wgpu::StoreOp::Store,
                    },
                    depth_slice: None,
                })],
                depth_stencil_attachment: None,
                ..Default::default()
            });

            let mut target = main_view.clone();
            let mut stack: Vec<usize> = Vec::new();
            let mut spans: Vec<Bounds<ScaledPixels>> = Vec::new();
            for batch in scene.batches() {
                let wanted = filtered
                    .then(|| scene.filtered(scene.batch_order(&batch)))
                    .flatten()
                    .map(|index| scene.filter_chain(index))
                    .unwrap_or_default();

                let shared = stack
                    .iter()
                    .zip(wanted.iter())
                    .take_while(|(open, next)| open == next)
                    .count();

                let mut merged = false;
                while stack.len() > shared {
                    if stack.len() == shared + 1
                        && wanted.len() == stack.len()
                        && let Some(open) = stack.last_mut()
                        && let Some(span) = spans.last_mut()
                    {
                        let next = scene.effects[wanted[shared]];
                        let held = scene.effects[*open];
                        if held.can_merge_with(&next) {
                            *open = wanted[shared];
                            *span = span.union(&next.destination_clip());
                            merged = true;
                            break;
                        }
                    }

                    let index = stack.pop().expect("the stack is not empty");
                    let layer = scene.effects[index];
                    let clip = spans.pop().unwrap_or_else(|| layer.destination_clip());

                    drop(pass);
                    let (onto, blurred, params, composite) = self.close_layer(
                        &mut encoder,
                        layer,
                        clip,
                        stack.len(),
                        &main_view,
                        &mut instance_offset,
                    )?;
                    target = onto;
                    pass = Self::resume_pass(
                        &mut encoder,
                        "layer_composite_pass",
                        &target,
                        wgpu::LoadOp::Load,
                    );
                    self.composite_layer(
                        &blurred,
                        layer.destination_scissor_bounds(clip),
                        composite,
                        &params,
                        &mut pass,
                    );
                }

                for index in wanted.iter().skip(shared + usize::from(merged)) {
                    if stack.len() >= LAYER_DEPTH {
                        break;
                    }
                    let layer = scene.effects[*index];
                    let depth = stack.len();

                    drop(pass);
                    target = self.filter_view(FilterTarget::Layer(depth));
                    pass = Self::resume_pass(
                        &mut encoder,
                        "layer_pass",
                        &target,
                        wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                    );
                    stack.push(*index);
                    spans.push(layer.destination_clip());
                }

                match batch {
                    PrimitiveBatch::Quads(range) => self.draw_instances(
                        &instance_bindings.quads,
                        &self.resources().pipelines.quads,
                        instance_range(range),
                        &mut pass,
                    ),
                    PrimitiveBatch::Shaders { shader, range } => {
                        if range.is_empty() {
                            continue;
                        }
                        if let Some((pipeline, shader_samples_backdrop)) = self.custom_pipeline(shader)
                        {
                            let shaders = &scene.shaders[range.clone()];
                            let first_shader = shaders[0];
                            let instances = instance_range(range);
                            if shader_samples_backdrop {
                                let backdrop_view = if filtered {
                                    let blur_sigma = first_shader.backdrop_blur_radius;
                                    let union_bounds = shaders
                                        .iter()
                                        .map(|instance| instance.bounds)
                                        .reduce(|acc, bounds| acc.union(&bounds));
                                    let refraction_margin = ScaledPixels(64.0);
                                    let blur_margin = if blur_sigma > 0.0 {
                                        BlurPasses::for_sigma(blur_sigma).source_margin()
                                    } else {
                                        ScaledPixels(0.0)
                                    };
                                    let clip = union_bounds
                                        .map(|bounds| bounds.dilate(refraction_margin));
                                    let source_clip = union_bounds.map(|bounds| {
                                        bounds.dilate(refraction_margin + blur_margin)
                                    });

                                    drop(pass);
                                    let source = self.backdrop_source(
                                        &mut encoder,
                                        &main_view,
                                        stack.len(),
                                        source_clip,
                                        &mut instance_offset,
                                    )?;
                                    let prepared = if blur_sigma > 0.0 {
                                        self.blur_source(
                                            &mut encoder,
                                            &source,
                                            false,
                                            blur_sigma,
                                            clip,
                                            &mut instance_offset,
                                        )?
                                    } else if stack.is_empty() {
                                        // Avoid binding the active color attachment (`main_view`)
                                        // as a sampled backdrop texture in the same render pass.
                                        let copy = self.filter_view(FilterTarget::Backdrop);
                                        let plain = self.write_instance_binding(
                                            "shader_backdrop_blit_bind_group",
                                            &mut instance_offset,
                                            &[BlurParams::default()],
                                        )?;
                                        let blit = self.resources().pipelines.blit.clone();
                                        let within = clip.map(|clip| self.scissor(clip, 1));
                                        self.fullscreen_pass(
                                            &mut encoder,
                                            "shader_backdrop_copy",
                                            &blit,
                                            &source,
                                            &copy,
                                            &plain,
                                            within,
                                        );
                                        copy
                                    } else {
                                        source
                                    };
                                    pass = Self::resume_pass(
                                        &mut encoder,
                                        "main_pass_continued",
                                        &target,
                                        wgpu::LoadOp::Load,
                                    );
                                    prepared
                                } else {
                                    drop(pass);
                                    let fallback = self.filter_view(FilterTarget::Backdrop);
                                    pass = Self::resume_pass(
                                        &mut encoder,
                                        "main_pass_continued",
                                        &target,
                                        wgpu::LoadOp::Load,
                                    );
                                    fallback
                                };
                                let globals_bind_group =
                                    self.create_custom_backdrop_globals_bind_group(&backdrop_view);
                                pass.set_pipeline(&pipeline);
                                pass.set_bind_group(0, &globals_bind_group, &[]);
                                pass.set_bind_group(1, &instance_bindings.shaders.bind_group, &[]);
                                pass.draw(
                                    0..4,
                                    instance_bindings.shaders.first_instance + instances.start
                                        ..instance_bindings.shaders.first_instance + instances.end,
                                );
                            } else {
                                self.draw_instances(
                                    &instance_bindings.shaders,
                                    &pipeline,
                                    instances,
                                    &mut pass,
                                );
                            }
                        }
                    }
                    PrimitiveBatch::Shadows(range) => self.draw_instances(
                        &instance_bindings.shadows,
                        &self.resources().pipelines.shadows,
                        instance_range(range),
                        &mut pass,
                    ),
                    PrimitiveBatch::Paths(range) => {
                        let paths = &scene.paths[range];
                        if paths.is_empty() {
                            continue;
                        }

                        drop(pass);
                        let rasterized = self.draw_paths_to_intermediate(
                            &mut encoder,
                            paths,
                            &mut instance_offset,
                        )?;

                        pass = Self::resume_pass(
                            &mut encoder,
                            "main_pass_continued",
                            &target,
                            wgpu::LoadOp::Load,
                        );

                        if rasterized {
                            self.draw_paths_from_intermediate(
                                paths,
                                &mut instance_offset,
                                &mut pass,
                            )?;
                        }
                    }
                    PrimitiveBatch::Underlines(range) => self.draw_instances(
                        &instance_bindings.underlines,
                        &self.resources().pipelines.underlines,
                        instance_range(range),
                        &mut pass,
                    ),
                    PrimitiveBatch::MonochromeSprites { texture_id, range } => self.draw_sprites(
                        &instance_bindings.monochrome_sprites,
                        texture_id,
                        &self.resources().pipelines.mono_sprites,
                        instance_range(range),
                        &mut pass,
                    ),
                    PrimitiveBatch::SubpixelSprites { texture_id, range } => {
                        let resources = self.resources();
                        let pipeline = match stack.is_empty() {
                            true => resources.pipelines.subpixel_sprites.as_ref(),
                            false => resources.pipelines.subpixel_sprites_layered.as_ref(),
                        };
                        self.draw_sprites(
                            &instance_bindings.subpixel_sprites,
                            texture_id,
                            pipeline.unwrap_or(&resources.pipelines.mono_sprites),
                            instance_range(range),
                            &mut pass,
                        );
                    }
                    PrimitiveBatch::PolychromeSprites { texture_id, range } => self.draw_sprites(
                        &instance_bindings.polychrome_sprites,
                        texture_id,
                        &self.resources().pipelines.poly_sprites,
                        instance_range(range),
                        &mut pass,
                    ),
                    PrimitiveBatch::Backdrops(range) => {
                        if !filtered {
                            continue;
                        }
                        let backdrops = &scene.backdrops[range.clone()];
                        let sigma = backdrops
                            .iter()
                            .fold(0., |widest: f32, backdrop| widest.max(backdrop.blur));
                        let clip = backdrops
                            .iter()
                            .map(|backdrop| backdrop.bounds)
                            .reduce(|union, bounds| union.union(&bounds));
                        drop(pass);
                        let source = self.backdrop_source(
                            &mut encoder,
                            &main_view,
                            stack.len(),
                            clip.map(|clip| {
                                clip.dilate(BlurPasses::for_sigma(sigma).source_margin())
                            }),
                            &mut instance_offset,
                        )?;
                        let blurred = self.blur_source(
                            &mut encoder,
                            &source,
                            false,
                            sigma,
                            clip,
                            &mut instance_offset,
                        )?;
                        pass = Self::resume_pass(
                            &mut encoder,
                            "main_pass_continued",
                            &target,
                            wgpu::LoadOp::Load,
                        );

                        self.draw_backdrops(
                            &instance_bindings.backdrops,
                            &blurred,
                            instance_range(range),
                            &mut pass,
                        );
                    }
                    PrimitiveBatch::Surfaces(range) => {
                        self.draw_surfaces(&scene.surfaces[range], &mut pass)
                    }
                }
            }

            while let Some(index) = stack.pop() {
                let layer = scene.effects[index];
                let clip = spans.pop().unwrap_or_else(|| layer.destination_clip());

                drop(pass);
                let (onto, blurred, params, composite) = self.close_layer(
                    &mut encoder,
                    layer,
                    clip,
                    stack.len(),
                    &main_view,
                    &mut instance_offset,
                )?;
                target = onto;
                pass = Self::resume_pass(
                    &mut encoder,
                    "layer_composite_pass",
                    &target,
                    wgpu::LoadOp::Load,
                );
                self.composite_layer(
                    &blurred,
                    layer.destination_scissor_bounds(clip),
                    composite,
                    &params,
                    &mut pass,
                );
            }
        }

        if mirrored {
            let plain = self.write_instance_binding(
                "frame_blit_bind_group",
                &mut instance_offset,
                &[BlurParams::default()],
            )?;
            let blit = self.resources().pipelines.blit.clone();
            self.fullscreen_pass(
                &mut encoder,
                "frame_blit",
                &blit,
                &main_view,
                frame_view,
                &plain,
                None,
            );
        }

        self.resources()
            .queue
            .submit(std::iter::once(encoder.finish()));

        let now = self.frame_time;
        self.resources_mut().release_targets_idle_at(now);
        Ok(())
    }

    fn close_layer(
        &mut self,
        encoder: &mut wgpu::CommandEncoder,
        layer: LayerEffect,
        clip: Bounds<ScaledPixels>,
        depth: usize,
        main_view: &wgpu::TextureView,
        instance_offset: &mut u64,
    ) -> Result<(
        wgpu::TextureView,
        wgpu::TextureView,
        InstanceBinding,
        Composite,
    )> {
        let source = self.filter_view(FilterTarget::Layer(depth.min(LAYER_DEPTH - 1)));
        let onto = match depth.checked_sub(1) {
            Some(parent) => self.filter_view(FilterTarget::Layer(parent.min(LAYER_DEPTH - 1))),
            None => main_view.clone(),
        };
        let mut mask = mask_params(layer, clip);
        let folded = match BlurPasses::for_sigma(layer.filter.blur) {
            BlurPasses::Gaussian(sigma) if layer.filter.blurs() => Some(sigma),
            _ => None,
        };
        let (blurred, composite) = match (folded, layer.filter.blurs()) {
            (Some(sigma), _) => {
                mask.gaussian_sigma = sigma;
                let across = self.gaussian_across(
                    encoder,
                    &source,
                    sigma,
                    Some(layer.blur_bounds(clip)),
                    instance_offset,
                )?;
                (across, Composite::Blurred)
            }
            (None, true) => (
                self.blur_source(
                    encoder,
                    &source,
                    true,
                    layer.filter.blur,
                    Some(layer.blur_bounds(clip)),
                    instance_offset,
                )?,
                Composite::of(layer),
            ),
            (None, false) => (source, Composite::of(layer)),
        };
        let params =
            self.write_instance_binding("layer_composite_bind_group", instance_offset, &[mask])?;
        Ok((onto, blurred, params, composite))
    }

    // Ported from gpui-ce #39 / #121: sample an RGBA wgpu texture in the scene.
    #[cfg(any(target_os = "linux", target_os = "freebsd"))]
    fn draw_surfaces(&self, surfaces: &[gpui::PaintSurface], pass: &mut wgpu::RenderPass<'_>) {
        let resources = self.resources();
        for surface in surfaces {
            let Some(wgpu_texture) = surface.texture.downcast_ref::<wgpu::Texture>() else {
                continue;
            };

            let texture_view = wgpu_texture.create_view(&wgpu::TextureViewDescriptor::default());

            let params = SurfaceParams {
                bounds: surface.bounds.into(),
                content_mask: surface.content_mask.bounds.into(),
            };

            resources.queue.write_buffer(
                &resources.surface_uniform_buffer,
                0,
                bytemuck::bytes_of(&params),
            );

            let bind_group = resources
                .device
                .create_bind_group(&wgpu::BindGroupDescriptor {
                    label: Some("surface_bind_group"),
                    layout: &resources.bind_group_layouts.surfaces,
                    entries: &[
                        wgpu::BindGroupEntry {
                            binding: 0,
                            resource: resources.surface_uniform_buffer.as_entire_binding(),
                        },
                        wgpu::BindGroupEntry {
                            binding: 1,
                            resource: wgpu::BindingResource::TextureView(&texture_view),
                        },
                        wgpu::BindGroupEntry {
                            binding: 2,
                            resource: wgpu::BindingResource::Sampler(&resources.surface_sampler),
                        },
                    ],
                });

            pass.set_pipeline(&resources.pipelines.surfaces);
            pass.set_bind_group(0, &resources.globals_bind_group, &[]);
            pass.set_bind_group(1, &bind_group, &[]);
            pass.draw(0..4, 0..1);
        }
    }

    #[cfg(not(any(target_os = "linux", target_os = "freebsd")))]
    fn draw_surfaces(&self, _surfaces: &[gpui::PaintSurface], _pass: &mut wgpu::RenderPass<'_>) {}

    fn write_instances(
        &mut self,
        scene: &Scene,
        instance_offset: &mut u64,
    ) -> Result<InstanceBindings> {
        Ok(InstanceBindings {
            backdrops: self.write_instance_binding(
                "backdrops_bind_group",
                instance_offset,
                &scene.backdrops,
            )?,
            quads: self.write_instance_binding(
                "quads_bind_group",
                instance_offset,
                &scene.quads,
            )?,
            shaders: self.write_instance_binding(
                "shaders_bind_group",
                instance_offset,
                &scene.shaders,
            )?,
            shadows: self.write_instance_binding(
                "shadows_bind_group",
                instance_offset,
                &scene.shadows,
            )?,
            underlines: self.write_instance_binding(
                "underlines_bind_group",
                instance_offset,
                &scene.underlines,
            )?,
            monochrome_sprites: self.write_instance_binding(
                "monochrome_sprites_bind_group",
                instance_offset,
                &scene.monochrome_sprites,
            )?,
            subpixel_sprites: self.write_instance_binding(
                "subpixel_sprites_bind_group",
                instance_offset,
                &scene.subpixel_sprites,
            )?,
            polychrome_sprites: self.write_instance_binding(
                "polychrome_sprites_bind_group",
                instance_offset,
                &scene.polychrome_sprites,
            )?,
        })
    }

    fn create_texture_bind_group(
        &self,
        label: &str,
        texture_view: &wgpu::TextureView,
    ) -> wgpu::BindGroup {
        let resources = self.resources();
        resources
            .device
            .create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some(label),
                layout: &resources.bind_group_layouts.texture,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: wgpu::BindingResource::TextureView(texture_view),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: wgpu::BindingResource::Sampler(&resources.atlas_sampler),
                    },
                ],
            })
    }

    fn create_filter_texture_bind_group(
        &self,
        label: &str,
        texture_view: &wgpu::TextureView,
    ) -> wgpu::BindGroup {
        let resources = self.resources();
        resources
            .device
            .create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some(label),
                layout: &resources.bind_group_layouts.texture,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: wgpu::BindingResource::TextureView(texture_view),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: wgpu::BindingResource::Sampler(&resources.filter_sampler),
                    },
                ],
            })
    }

    fn create_custom_backdrop_globals_bind_group(
        &self,
        backdrop_view: &wgpu::TextureView,
    ) -> wgpu::BindGroup {
        let resources = self.resources();
        let globals_size = std::mem::size_of::<GlobalParams>() as u64;
        resources
            .device
            .create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("custom_backdrop_globals_bind_group"),
                layout: &resources.bind_group_layouts.custom_backdrop_globals,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: wgpu::BindingResource::Buffer(wgpu::BufferBinding {
                            buffer: &resources.globals_buffer,
                            offset: 0,
                            size: NonZeroU64::new(globals_size),
                        }),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: wgpu::BindingResource::TextureView(backdrop_view),
                    },
                    wgpu::BindGroupEntry {
                        binding: 2,
                        resource: wgpu::BindingResource::Sampler(&resources.filter_sampler),
                    },
                ],
            })
    }

    fn custom_pipeline(&mut self, shader: ShaderId) -> Option<(wgpu::RenderPipeline, bool)> {
        if let Some(entry) = self.resources().pipelines.custom.get(&shader) {
            let samples_backdrop = gpui::shader_program(shader).is_some_and(|p| p.samples_backdrop);
            return entry.clone().map(|pipeline| (pipeline, samples_backdrop));
        }
        let created = self.create_custom_pipeline(shader);
        let pipeline = created.as_ref().map(|(pipeline, _)| pipeline.clone());
        self.resources_mut()
            .pipelines
            .custom
            .insert(shader, pipeline);
        created
    }

    fn create_custom_pipeline(&self, shader: ShaderId) -> Option<(wgpu::RenderPipeline, bool)> {
        let Some(program) = gpui::shader_program(shader) else {
            log::error!("custom shader {} was never registered", shader.0);
            return None;
        };
        let transport = match self.uses_webgl_instance_data {
            true => CUSTOM_SHADER_WEBGL_TRANSPORT,
            false => gpui::SHADER_STORAGE_TRANSPORT,
        };
        let resources = self.resources();
        let device = &resources.device;
        let globals_layout = if program.samples_backdrop {
            &resources.bind_group_layouts.custom_backdrop_globals
        } else {
            &resources.bind_group_layouts.globals
        };

        #[cfg(not(target_family = "wasm"))]
        let scope = device.push_error_scope(wgpu::ErrorFilter::Validation);
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some(&program.label),
            source: wgpu::ShaderSource::Wgsl(program.compose(transport).into()),
        });
        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some(&program.label),
            bind_group_layouts: &[Some(globals_layout), Some(&resources.bind_group_layouts.instances)],
            immediate_size: 0,
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some(&program.label),
            layout: Some(&layout),
            vertex: wgpu::VertexState {
                module: &module,
                entry_point: Some(gpui::SHADER_VERTEX_ENTRY),
                buffers: &[],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &module,
                entry_point: Some(gpui::SHADER_FRAGMENT_ENTRY),
                targets: &[Some(resources.pipelines.custom_target.clone())],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleStrip,
                ..Default::default()
            },
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview_mask: None,
            cache: None,
        });
        #[cfg(not(target_family = "wasm"))]
        if let Some(error) = gpui::block_on(scope.pop()) {
            log::error!(
                "custom shader `{}` failed to compile: {error}",
                program.label
            );
            return None;
        }
        Some((pipeline, program.samples_backdrop))
    }

    fn draw_instances(
        &self,
        instances: &InstanceBinding,
        pipeline: &wgpu::RenderPipeline,
        range: Range<u32>,
        pass: &mut wgpu::RenderPass<'_>,
    ) {
        if range.is_empty() {
            return;
        }
        pass.set_pipeline(pipeline);
        pass.set_bind_group(0, &self.resources().globals_bind_group, &[]);
        pass.set_bind_group(1, &instances.bind_group, &[]);
        pass.draw(
            0..4,
            instances.first_instance + range.start..instances.first_instance + range.end,
        );
    }

    fn draw_sprites(
        &self,
        sprite_instances: &InstanceBinding,
        texture_id: AtlasTextureId,
        pipeline: &wgpu::RenderPipeline,
        range: Range<u32>,
        pass: &mut wgpu::RenderPass<'_>,
    ) {
        if range.is_empty() {
            return;
        }
        let texture_info = self.atlas.get_texture_info(texture_id);
        let texture =
            self.create_texture_bind_group("atlas_texture_bind_group", &texture_info.view);
        pass.set_pipeline(pipeline);
        pass.set_bind_group(0, &self.resources().globals_bind_group, &[]);
        pass.set_bind_group(1, &sprite_instances.bind_group, &[]);
        pass.set_bind_group(2, &texture, &[]);
        pass.draw(
            0..4,
            sprite_instances.first_instance + range.start
                ..sprite_instances.first_instance + range.end,
        );
    }

    unsafe fn instance_bytes<T>(instances: &[T]) -> &[u8] {
        unsafe {
            std::slice::from_raw_parts(
                instances.as_ptr() as *const u8,
                std::mem::size_of_val(instances),
            )
        }
    }

    fn draw_paths_from_intermediate(
        &mut self,
        paths: &[Path<ScaledPixels>],
        instance_offset: &mut u64,
        pass: &mut wgpu::RenderPass<'_>,
    ) -> Result<()> {
        let first_path = &paths[0];
        let sprites: Vec<PathSprite> = if paths.last().map(|p| &p.order) == Some(&first_path.order)
        {
            paths
                .iter()
                .map(|p| PathSprite {
                    bounds: p.clipped_bounds(),
                })
                .collect()
        } else {
            let mut bounds = first_path.clipped_bounds();
            for path in paths.iter().skip(1) {
                bounds = bounds.union(&path.clipped_bounds());
            }
            vec![PathSprite { bounds }]
        };

        let Some(path_intermediate_view) = self
            .resources()
            .path_intermediate
            .as_ref()
            .map(|scratch| scratch.view.clone())
        else {
            return Ok(());
        };
        let instances =
            self.write_instance_binding("path_sprites_bind_group", instance_offset, &sprites)?;
        let texture = self.create_texture_bind_group(
            "path_intermediate_texture_bind_group",
            &path_intermediate_view,
        );
        let resources = self.resources();
        pass.set_pipeline(&resources.pipelines.paths);
        pass.set_bind_group(0, &resources.globals_bind_group, &[]);
        pass.set_bind_group(1, &instances.bind_group, &[]);
        pass.set_bind_group(2, &texture, &[]);
        pass.draw(
            0..4,
            instances.first_instance..instances.first_instance + sprites.len() as u32,
        );
        Ok(())
    }

    fn draw_paths_to_intermediate(
        &mut self,
        encoder: &mut wgpu::CommandEncoder,
        paths: &[Path<ScaledPixels>],
        instance_offset: &mut u64,
    ) -> Result<bool> {
        let mut vertices = Vec::new();
        for path in paths {
            let bounds = path.clipped_bounds();
            vertices.extend(path.vertices.iter().map(|v| PathRasterizationVertex {
                xy_position: v.xy_position,
                st_position: v.st_position,
                color: path.color,
                bounds,
            }));
        }

        if vertices.is_empty() {
            return Ok(false);
        }

        let vertex_binding = self.write_instance_binding(
            "path_rasterization_bind_group",
            instance_offset,
            &vertices,
        )?;

        let (path_intermediate_view, path_msaa_view) = self.path_views();
        let (target_view, resolve_target, store) = match &path_msaa_view {
            Some(msaa_view) => (
                msaa_view,
                Some(&path_intermediate_view),
                wgpu::StoreOp::Discard,
            ),
            None => (&path_intermediate_view, None, wgpu::StoreOp::Store),
        };

        let resources = self.resources();
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("path_rasterization_pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: target_view,
                    resolve_target,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                        store,
                    },
                    depth_slice: None,
                })],
                depth_stencil_attachment: None,
                ..Default::default()
            });

            pass.set_pipeline(&resources.pipelines.path_rasterization);
            pass.set_bind_group(0, &resources.path_globals_bind_group, &[]);
            pass.set_bind_group(1, &vertex_binding.bind_group, &[]);
            // The path rasterization shader loads records by vertex index
            // rather than instance index, so the allocation's base shifts the
            // vertex range here.
            pass.draw(
                vertex_binding.first_instance
                    ..vertex_binding.first_instance + vertices.len() as u32,
                0..1,
            );
        }

        Ok(true)
    }

    fn write_instance_binding<T>(
        &mut self,
        label: &str,
        instance_offset: &mut u64,
        instances: &[T],
    ) -> Result<InstanceBinding> {
        let data = unsafe { Self::instance_bytes(instances) };
        // wgpu rejects zero-sized bindings, so empty primitive arrays still
        // reserve the 16-byte minimum.
        let size = (data.len() as u64).max(16);
        let stride = (std::mem::size_of::<T>() as u64).max(1);
        let (alignment, allocation_size) = if self.uses_webgl_instance_data {
            // The texture transport has no binding offset: the shader indexes
            // the instance texture absolutely, so each allocation must start on
            // a whole instance (a stride multiple) and a whole texel, and must
            // end on a texel boundary so the zero padding of its final partial
            // texel cannot overlap the next allocation.
            (
                least_common_multiple(self.instance_data_alignment, stride),
                size.next_multiple_of(INSTANCE_TEXTURE_TEXEL_SIZE),
            )
        } else {
            (self.instance_data_alignment.max(1), size)
        };
        let mut offset = (*instance_offset).next_multiple_of(alignment);
        if offset + allocation_size > self.instance_data_capacity {
            self.grow_instance_data(allocation_size)?;
            offset = 0;
        }
        *instance_offset = offset + allocation_size;

        let first_instance = if self.uses_webgl_instance_data {
            u32::try_from(offset / stride).context("instance index exceeds u32 range")?
        } else {
            0
        };

        let resources = self.resources();
        if !data.is_empty() {
            match &resources.instance_data {
                InstanceData::Storage(buffer) => resources.queue.write_buffer(buffer, offset, data),
                InstanceData::Texture { .. } => {
                    Self::write_instance_texture(resources, offset, data)
                }
            }
        }
        let bind_group = resources
            .device
            .create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some(label),
                layout: &resources.bind_group_layouts.instances,
                entries: &[wgpu::BindGroupEntry {
                    binding: 0,
                    resource: match &resources.instance_data {
                        InstanceData::Storage(buffer) => {
                            wgpu::BindingResource::Buffer(wgpu::BufferBinding {
                                buffer,
                                offset,
                                size: NonZeroU64::new(size),
                            })
                        }
                        InstanceData::Texture { view, .. } => {
                            wgpu::BindingResource::TextureView(view)
                        }
                    },
                }],
            });
        Ok(InstanceBinding {
            bind_group,
            first_instance,
        })
    }

    fn write_instance_texture(resources: &WgpuResources, offset: u64, data: &[u8]) {
        let InstanceData::Texture {
            texture,
            width,
            height,
            ..
        } = &resources.instance_data
        else {
            return;
        };
        let mut byte_offset = 0usize;
        let mut texel_offset = offset / INSTANCE_TEXTURE_TEXEL_SIZE;
        while byte_offset < data.len() {
            let x = (texel_offset % u64::from(*width)) as u32;
            let y = (texel_offset / u64::from(*width)) as u32;
            if y >= *height {
                // The capacity check in write_instance_binding should make this
                // unreachable. Truncating silently would leave stale bytes in the
                // texture and draw garbage for the remaining instances.
                debug_assert!(
                    false,
                    "instance texture write out of bounds: row {y} >= height {}",
                    *height
                );
                log::error!(
                    "instance texture write out of bounds; dropping {} bytes of instance data",
                    data.len() - byte_offset
                );
                return;
            }
            let available_texels = u64::from(*width - x);
            let remaining_bytes = data.len() - byte_offset;
            let complete_texels = remaining_bytes as u64 / INSTANCE_TEXTURE_TEXEL_SIZE;
            let texels = complete_texels.min(available_texels);
            if texels > 0 {
                let byte_count = (texels * INSTANCE_TEXTURE_TEXEL_SIZE) as usize;
                resources.queue.write_texture(
                    wgpu::TexelCopyTextureInfo {
                        texture,
                        mip_level: 0,
                        origin: wgpu::Origin3d { x, y, z: 0 },
                        aspect: wgpu::TextureAspect::All,
                    },
                    &data[byte_offset..byte_offset + byte_count],
                    wgpu::TexelCopyBufferLayout {
                        offset: 0,
                        bytes_per_row: Some(byte_count as u32),
                        rows_per_image: None,
                    },
                    wgpu::Extent3d {
                        width: texels as u32,
                        height: 1,
                        depth_or_array_layers: 1,
                    },
                );
                byte_offset += byte_count;
                texel_offset += texels;
                continue;
            }

            let mut final_texel = [0; INSTANCE_TEXTURE_TEXEL_SIZE as usize];
            final_texel[..remaining_bytes].copy_from_slice(&data[byte_offset..]);
            resources.queue.write_texture(
                wgpu::TexelCopyTextureInfo {
                    texture,
                    mip_level: 0,
                    origin: wgpu::Origin3d { x, y, z: 0 },
                    aspect: wgpu::TextureAspect::All,
                },
                &final_texel,
                wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(INSTANCE_TEXTURE_TEXEL_SIZE as u32),
                    rows_per_image: None,
                },
                wgpu::Extent3d {
                    width: 1,
                    height: 1,
                    depth_or_array_layers: 1,
                },
            );
            break;
        }
    }

    fn grow_instance_data(&mut self, required: u64) -> Result<()> {
        let capacity = (self.instance_data_capacity * 2)
            .max(required.next_power_of_two())
            .min(self.max_instance_data_size);
        anyhow::ensure!(
            capacity >= required,
            "instance data needs {required} bytes, above the maximum of {}",
            self.max_instance_data_size
        );
        anyhow::ensure!(
            capacity > self.instance_data_capacity,
            "frame instance data exceeds the {}-byte maximum",
            self.max_instance_data_size
        );
        log::debug!(
            "instance data grown from {} to {capacity}",
            self.instance_data_capacity
        );
        // Bind groups created earlier in the frame keep the previous buffer or
        // texture alive, so allocations written before the grow remain valid;
        // only subsequent writes land in the new allocation.
        let uses_webgl_instance_data = self.uses_webgl_instance_data;
        let resources = self.resources_mut();
        if uses_webgl_instance_data {
            let max_texture_dimension = resources.device.limits().max_texture_dimension_2d;
            let (instance_data, actual_capacity) =
                Self::create_instance_texture(&resources.device, capacity, max_texture_dimension);
            resources.instance_data = instance_data;
            self.instance_data_capacity = actual_capacity;
        } else {
            resources.instance_data =
                InstanceData::Storage(resources.device.create_buffer(&wgpu::BufferDescriptor {
                    label: Some("instance_buffer"),
                    size: capacity,
                    usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
                    mapped_at_creation: false,
                }));
            self.instance_data_capacity = capacity;
        }
        Ok(())
    }

    /// Mark the surface as unconfigured so rendering is skipped until a new
    /// surface is provided via [`replace_surface`](Self::replace_surface).
    ///
    /// This does **not** drop the renderer — the device, queue, atlas, and
    /// pipelines stay alive.  Use this when the native window is destroyed
    /// (e.g. Android `TerminateWindow`) but you intend to re-create the
    /// surface later without losing cached atlas textures.
    pub fn unconfigure_surface(&mut self) {
        self.surface_configured = false;
        // Drop intermediate textures since they reference the old surface size.
        if let Some(res) = self.resources.as_mut() {
            res.invalidate_intermediate_textures();
        }
    }

    /// Replace the wgpu surface with a new one (e.g. after Android destroys
    /// and recreates the native window).  Keeps the device, queue, atlas, and
    /// all pipelines intact so cached `AtlasTextureId`s remain valid.
    ///
    /// The `instance` **must** be the same [`wgpu::Instance`] that was used to
    /// create the adapter and device (i.e. from the [`WgpuContext`]).  Using a
    /// different instance will cause a "Device does not exist" panic because
    /// the wgpu device is bound to its originating instance.
    #[cfg(not(target_family = "wasm"))]
    pub fn replace_surface<W: HasWindowHandle>(
        &mut self,
        window: &W,
        config: WgpuSurfaceConfig,
        instance: &wgpu::Instance,
    ) -> anyhow::Result<()> {
        let window_handle = window
            .window_handle()
            .map_err(|e| anyhow::anyhow!("Failed to get window handle: {e}"))?;

        let surface = create_surface(instance, window_handle.as_raw())?;

        let width = (config.size.width.0 as u32).max(1);
        let height = (config.size.height.0 as u32).max(1);

        let alpha_mode = if config.transparent {
            self.transparent_alpha_mode
        } else {
            self.opaque_alpha_mode
        };

        self.surface_config.width = width;
        self.surface_config.height = height;
        self.surface_config.alpha_mode = alpha_mode;
        if let Some(mode) = config.preferred_present_mode {
            self.surface_config.present_mode = mode;
        }

        {
            let res = self
                .resources
                .as_mut()
                .expect("GPU resources not available");
            surface.configure(&res.device, &self.surface_config);
            res.surface = Some(surface);

            // Invalidate intermediate textures — they'll be recreated lazily.
            res.invalidate_intermediate_textures();
        }

        self.surface_configured = true;

        Ok(())
    }

    /// Frees offscreen targets that no frame has drawn through for `IDLE_RELEASE`.
    #[allow(dead_code)]
    pub fn release_idle_targets(&mut self) {
        let Some(resources) = self.resources.as_mut() else {
            return;
        };
        resources.release_targets_idle_at(Instant::now());
        if let Err(error) = resources.device.poll(wgpu::PollType::Poll) {
            warn!("Failed to poll device after releasing idle targets: {error:?}");
        }
    }

    pub fn destroy(&mut self) {
        // Release surface-bound GPU resources eagerly so the underlying native
        // window can be destroyed before the renderer itself is dropped.
        self.resources.take();
    }

    /// Returns true if the GPU device was lost and recovery is needed.
    pub fn device_lost(&self) -> bool {
        self.device_lost.load(std::sync::atomic::Ordering::SeqCst)
    }

    /// Returns true if a redraw is needed because GPU state was cleared.
    /// Calling this method clears the flag.
    pub fn needs_redraw(&mut self) -> bool {
        std::mem::take(&mut self.needs_redraw)
    }

    /// Recovers from a lost GPU device by recreating the renderer with a new context.
    ///
    /// Call this after detecting `device_lost()` returns true.
    ///
    /// This method coordinates recovery across multiple windows:
    /// - The first window to call this will recreate the shared context
    /// - Subsequent windows will adopt the already-recovered context
    #[cfg(not(target_family = "wasm"))]
    pub fn recover<W>(&mut self, window: &W) -> anyhow::Result<()>
    where
        W: HasWindowHandle + HasDisplayHandle + std::fmt::Debug + Send + Sync + Clone + 'static,
    {
        let gpu_context = self.context.as_ref().expect("recover requires gpu_context");

        // Check if another window already recovered the context
        let needs_new_context = gpu_context
            .borrow()
            .as_ref()
            .is_none_or(|ctx| ctx.device_lost());

        let window_handle = window
            .window_handle()
            .map_err(|e| anyhow::anyhow!("Failed to get window handle: {e}"))?;

        let surface = if needs_new_context {
            log::warn!("GPU device lost, recreating context...");

            // Drop old resources to release Arc<Device>/Arc<Queue> and GPU resources
            self.resources = None;
            *gpu_context.borrow_mut() = None;

            // Wait briefly for the GPU driver to stabilize, then try to
            // recreate the context without software renderers. If this fails
            // the caller should request another frame and retry — the real GPU
            // may need more time to come back (e.g. after suspend/resume).
            std::thread::sleep(std::time::Duration::from_millis(350));

            let instance = WgpuContext::instance(Box::new(window.clone()));
            let surface = create_surface(&instance, window_handle.as_raw())?;
            let new_context =
                WgpuContext::new_rejecting_software(instance, &surface, self.compositor_gpu)?;
            *gpu_context.borrow_mut() = Some(new_context);
            surface
        } else {
            let ctx_ref = gpu_context.borrow();
            let instance = &ctx_ref.as_ref().unwrap().instance;
            create_surface(instance, window_handle.as_raw())?
        };

        let config = WgpuSurfaceConfig {
            size: gpui::Size {
                width: gpui::DevicePixels(self.surface_config.width as i32),
                height: gpui::DevicePixels(self.surface_config.height as i32),
            },
            transparent: self.surface_config.alpha_mode != wgpu::CompositeAlphaMode::Opaque,
            preferred_present_mode: Some(self.surface_config.present_mode),
        };
        let gpu_context = Rc::clone(gpu_context);
        let ctx_ref = gpu_context.borrow();
        let context = ctx_ref.as_ref().expect("context should exist");

        self.resources = None;
        self.atlas.handle_device_lost(context);

        *self = Self::new_internal(
            Some(gpu_context.clone()),
            context,
            Some(surface),
            config,
            self.compositor_gpu,
            self.atlas.clone(),
        )?;

        log::info!("GPU recovery complete");
        Ok(())
    }
}

#[derive(Clone, Copy)]
enum Composite {
    Plain,
    Masked,
    Blurred,
}

impl Composite {
    fn of(layer: LayerEffect) -> Self {
        match layer.filter.fades() || layer.filter.clips_corners() {
            true => Self::Masked,
            false => Self::Plain,
        }
    }
}

fn mask_params(layer: LayerEffect, destination_span: Bounds<ScaledPixels>) -> MaskParams {
    let inv = layer.filter.inverse_matrix();
    let fwd = layer.filter.forward_matrix();
    let mut transform_flags = 0u32;
    if !layer.filter.transforms() {
        transform_flags |= 1 << 0;
    } else if !layer.filter.rotates_or_skews() {
        transform_flags |= 1 << 1;
    }
    let source_bounds = if layer.filter.transforms() {
        layer.source_bounds
    } else {
        destination_span
    };
    let fade_bounds = layer.clip_bounds;
    MaskParams {
        source_bounds: [
            source_bounds.origin.x.0,
            source_bounds.origin.y.0,
            source_bounds.size.width.0,
            source_bounds.size.height.0,
        ],
        fade_bounds: [
            fade_bounds.origin.x.0,
            fade_bounds.origin.y.0,
            fade_bounds.size.width.0,
            fade_bounds.size.height.0,
        ],
        transform_origin: [layer.transform_origin.x.0, layer.transform_origin.y.0],
        translation: [layer.filter.translate.x.0, layer.filter.translate.y.0],
        inv_matrix: [inv[0][0], inv[0][1], inv[1][0], inv[1][1]],
        fwd_matrix: [fwd[0][0], fwd[0][1], fwd[1][0], fwd[1][1]],
        fade_top: layer.filter.fade_top,
        fade_bottom: layer.filter.fade_bottom,
        fade_left: layer.filter.fade_left,
        fade_right: layer.filter.fade_right,
        clip_radii: [
            layer.filter.clip_radii.top_left.0,
            layer.filter.clip_radii.top_right.0,
            layer.filter.clip_radii.bottom_right.0,
            layer.filter.clip_radii.bottom_left.0,
        ],
        clip_smoothing: layer.filter.clip_smoothing,
        transform_flags,
        gaussian_sigma: 0.0,
        _pad0: 0,
    }
}

fn instance_range(range: Range<usize>) -> Range<u32> {
    range.start as u32..range.end as u32
}

#[cfg(not(target_family = "wasm"))]
fn create_surface(
    instance: &wgpu::Instance,
    raw_window_handle: raw_window_handle::RawWindowHandle,
) -> anyhow::Result<wgpu::Surface<'static>> {
    unsafe {
        instance
            .create_surface_unsafe(wgpu::SurfaceTargetUnsafe::RawHandle {
                // Fall back to the display handle already provided via InstanceDescriptor::display.
                raw_display_handle: None,
                raw_window_handle,
            })
            .map_err(|e| anyhow::anyhow!("{e}"))
    }
}

struct RenderingParameters {
    path_sample_count: u32,
    gamma_ratios: [f32; 4],
    grayscale_enhanced_contrast: f32,
    subpixel_enhanced_contrast: f32,
}

impl RenderingParameters {
    fn new(adapter: &wgpu::Adapter, surface_format: wgpu::TextureFormat) -> Self {
        use std::env;

        let format_features = adapter.get_texture_format_features(surface_format);
        let path_sample_count = [4, 2, 1]
            .into_iter()
            .find(|&n| format_features.flags.sample_count_supported(n))
            .unwrap_or(1);

        let gamma = env::var("ZED_FONTS_GAMMA")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(1.8_f32)
            .clamp(1.0, 2.2);
        let gamma_ratios = get_gamma_correction_ratios(gamma);

        let grayscale_enhanced_contrast = env::var("ZED_FONTS_GRAYSCALE_ENHANCED_CONTRAST")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(1.0_f32)
            .max(0.0);

        let subpixel_enhanced_contrast = env::var("ZED_FONTS_SUBPIXEL_ENHANCED_CONTRAST")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(0.5_f32)
            .max(0.0);

        Self {
            path_sample_count,
            gamma_ratios,
            grayscale_enhanced_contrast,
            subpixel_enhanced_contrast,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::{
        BorderStyle, ContentMask, Corners, Edges, Filter, MonochromeSprite, PolychromeSprite, Quad,
        SHADER_COLOR_COUNT, SHADER_FLAG_SAMPLES_BACKDROP, SHADER_PARAM_COUNT, Shader, ShaderQuad,
        ShaderSource, Shadow, SubpixelSprite, Underline, blue, red, transparent_black,
    };
    use std::f32::consts::FRAC_PI_2;

    #[test]
    fn webgl_shader_is_valid_wgsl_without_storage_buffers() {
        assert!(!WEBGL_SHADERS.contains("var<storage"));
        validate_wgsl(WEBGL_SHADERS, naga::valid::Capabilities::empty());
    }

    #[test]
    fn storage_buffer_shader_is_valid_wgsl() {
        validate_wgsl(STORAGE_BUFFER_SHADERS, naga::valid::Capabilities::empty());
    }

    #[test]
    fn custom_shader_webgl_transport_is_valid_wgsl() {
        let source = format!(
            "{}\n{}\n{}",
            gpui::SHADER_PRELUDE,
            CUSTOM_SHADER_WEBGL_TRANSPORT,
            include_str!("test-color.wgsl"),
        );
        assert!(!source.contains("var<storage"));
        validate_wgsl(&source, naga::valid::Capabilities::empty());
        assert_eq!(std::mem::size_of::<ShaderQuad>(), 13 * 16);
    }

    #[test]
    fn subpixel_shader_is_valid_wgsl() {
        validate_wgsl(
            SUBPIXEL_SHADERS,
            naga::valid::Capabilities::DUAL_SOURCE_BLENDING,
        );
    }

    fn validate_wgsl(source: &str, capabilities: naga::valid::Capabilities) {
        let module = naga::front::wgsl::parse_str(source).expect("shader should parse");
        naga::valid::Validator::new(naga::valid::ValidationFlags::all(), capabilities)
            .validate(&module)
            .expect("shader should validate");
    }

    #[test]
    fn webgl_record_sizes_match_shader_word_strides() {
        assert_eq!(std::mem::size_of::<Quad>(), 42 * 4);
        assert_eq!(std::mem::size_of::<Shadow>(), 28 * 4);
        assert_eq!(std::mem::size_of::<PathRasterizationVertex>(), 26 * 4);
        assert_eq!(std::mem::size_of::<PathSprite>(), 4 * 4);
        assert_eq!(std::mem::size_of::<Underline>(), 16 * 4);
        assert_eq!(std::mem::size_of::<MonochromeSprite>(), 28 * 4);
        assert_eq!(std::mem::size_of::<SubpixelSprite>(), 28 * 4);
        assert_eq!(std::mem::size_of::<PolychromeSprite>(), 24 * 4);
        assert_eq!(std::mem::size_of::<MaskParams>(), 32 * 4);
    }

    // gpui-ce samples an RGBA wgpu texture, not YCbCr video planes.
    // https://github.com/gpui-ce/gpui-ce/commit/6d043b22e477
    #[test]
    fn surface_shader_samples_a_single_rgba_texture() {
        assert!(
            STORAGE_BUFFER_SHADERS.contains("@group(1) @binding(1) var t_surface: texture_2d<f32>")
        );
        assert!(!STORAGE_BUFFER_SHADERS.contains("var t_y: texture_2d<f32>"));
        assert!(!STORAGE_BUFFER_SHADERS.contains("var t_cb_cr: texture_2d<f32>"));
        assert!(WEBGL_SHADERS.contains("@group(1) @binding(1) var t_surface: texture_2d<f32>"));
    }

    #[cfg(not(target_family = "wasm"))]
    #[test]
    fn backdrop_custom_shader_samples_scene_on_wgpu() {
        let viewport = size(DevicePixels(64), DevicePixels(64));
        let context = WgpuContext::new_offscreen().expect("offscreen WGPU context");
        let mut renderer =
            WgpuRenderer::new_offscreen(&context, viewport).expect("offscreen WGPU renderer");
        let full_bounds = Bounds::new(
            point(ScaledPixels(0.), ScaledPixels(0.)),
            size(ScaledPixels(64.), ScaledPixels(64.)),
        );
        let mask = ContentMask {
            bounds: full_bounds,
        };

        let mut scene = Scene::default();
        scene.insert_primitive(Quad {
            order: 0,
            border_style: BorderStyle::Solid,
            bounds: full_bounds,
            content_mask: mask,
            background: red().into(),
            border_color: transparent_black(),
            corner_radii: Corners::default(),
            border_widths: Edges::default(),
            corner_smoothing: 0.0,
            pad: 0,
        });

        let shader = Shader::new(
            ShaderSource::new(
                "swap_rb_backdrop_wgpu",
                include_str!("test-backdrop.wgsl"),
            )
            .samples_backdrop(true),
        )
        .expect("backdrop shader must compile for WGPU");

        scene.insert_primitive(ShaderQuad {
            order: 0,
            shader: shader.id(),
            opacity: 1.0,
            time: 0.0,
            bounds: Bounds::new(
                point(ScaledPixels(16.), ScaledPixels(16.)),
                size(ScaledPixels(32.), ScaledPixels(32.)),
            ),
            content_mask: mask,
            corner_radii: Corners::default(),
            scale_factor: 1.0,
            corner_smoothing: 0.0,
            flags: SHADER_FLAG_SAMPLES_BACKDROP,
            backdrop_blur_radius: 0.0,
            params: [0.0; SHADER_PARAM_COUNT],
            colors: [[0.0; 4]; SHADER_COLOR_COUNT],
        });
        scene.finish();

        let mut pixels = vec![0u8; 64 * 64 * 4];
        renderer
            .render_to_pixels(&scene, viewport, &mut pixels)
            .expect("WGPU offscreen render succeeds");

        let pixel = |x: usize, y: usize| -> [u8; 4] {
            let offset = (y * 64 + x) * 4;
            [
                pixels[offset],
                pixels[offset + 1],
                pixels[offset + 2],
                pixels[offset + 3],
            ]
        };

        let outer = pixel(4, 4);
        assert!(
            outer[0] > 240 && outer[1] < 15 && outer[2] < 15,
            "expected red background at (4,4), got {outer:?}"
        );

        let inner = pixel(32, 32);
        assert!(
            inner[0] < 15 && inner[1] > 240 && inner[2] < 15,
            "expected green swapped backdrop inside custom shader at (32,32), got {inner:?}"
        );
    }

    #[cfg(not(target_family = "wasm"))]
    #[test]
    fn rotated_layer_effect_composites_with_affine_matrix_on_wgpu() {
        let viewport = size(DevicePixels(64), DevicePixels(64));
        let context = WgpuContext::new_offscreen().expect("offscreen WGPU context");
        let mut renderer =
            WgpuRenderer::new_offscreen(&context, viewport).expect("offscreen WGPU renderer");
        let full_bounds = Bounds::new(
            point(ScaledPixels(0.), ScaledPixels(0.)),
            size(ScaledPixels(64.), ScaledPixels(64.)),
        );
        let mask = ContentMask {
            bounds: full_bounds,
        };
        let bar_bounds = Bounds::new(
            point(ScaledPixels(16.), ScaledPixels(28.)),
            size(ScaledPixels(32.), ScaledPixels(8.)),
        );

        let mut scene = Scene::default();
        scene.push_filter(
            bar_bounds,
            bar_bounds,
            point(ScaledPixels(32.), ScaledPixels(32.)),
            full_bounds,
            Filter {
                rotate_rad: FRAC_PI_2,
                ..Default::default()
            },
        );
        scene.insert_primitive(Quad {
            order: 0,
            border_style: BorderStyle::Solid,
            bounds: bar_bounds,
            content_mask: mask,
            background: blue().into(),
            border_color: transparent_black(),
            corner_radii: Corners::default(),
            border_widths: Edges::default(),
            corner_smoothing: 0.0,
            pad: 0,
        });
        scene.pop_filter();
        scene.finish();

        let mut pixels = vec![0u8; 64 * 64 * 4];
        renderer
            .render_to_pixels(&scene, viewport, &mut pixels)
            .expect("WGPU offscreen rotated layer render succeeds");

        let pixel = |x: usize, y: usize| -> [u8; 4] {
            let offset = (y * 64 + x) * 4;
            [
                pixels[offset],
                pixels[offset + 1],
                pixels[offset + 2],
                pixels[offset + 3],
            ]
        };

        let rotated = pixel(32, 18);
        assert!(
            rotated[2] > 200 && rotated[0] < 15 && rotated[1] < 15,
            "expected blue pixel at rotated vertical bar (32,18), got {rotated:?}"
        );

        let unrotated = pixel(18, 32);
        assert!(
            unrotated[0] < 15 && unrotated[1] < 15 && unrotated[2] < 15,
            "expected black/transparent background at original horizontal bar (18,32), got {unrotated:?}"
        );
    }

    #[cfg(not(target_family = "wasm"))]
    #[test]
    fn rounded_corner_clip_masks_overflowing_child_on_wgpu() {
        let viewport = size(DevicePixels(64), DevicePixels(64));
        let context = WgpuContext::new_offscreen().expect("offscreen WGPU context");
        let mut renderer =
            WgpuRenderer::new_offscreen(&context, viewport).expect("offscreen WGPU renderer");
        let clip_bounds = Bounds::new(
            point(ScaledPixels(8.), ScaledPixels(8.)),
            size(ScaledPixels(48.), ScaledPixels(48.)),
        );
        let mask = ContentMask {
            bounds: clip_bounds,
        };

        let mut scene = Scene::default();
        scene.push_filter(
            clip_bounds,
            clip_bounds,
            clip_bounds.center(),
            clip_bounds,
            Filter {
                clip_radii: Corners::all(ScaledPixels(16.0)),
                clip_smoothing: 0.6,
                ..Default::default()
            },
        );
        scene.insert_primitive(Quad {
            order: 0,
            border_style: BorderStyle::Solid,
            bounds: clip_bounds,
            content_mask: mask,
            background: red().into(),
            border_color: transparent_black(),
            corner_radii: Corners::default(),
            border_widths: Edges::default(),
            corner_smoothing: 0.0,
            pad: 0,
        });
        scene.pop_filter();
        scene.finish();

        let mut pixels = vec![0u8; 64 * 64 * 4];
        renderer
            .render_to_pixels(&scene, viewport, &mut pixels)
            .expect("WGPU offscreen rounded corner clip render succeeds");

        let pixel = |x: usize, y: usize| -> [u8; 4] {
            let offset = (y * 64 + x) * 4;
            [
                pixels[offset],
                pixels[offset + 1],
                pixels[offset + 2],
                pixels[offset + 3],
            ]
        };

        let center = pixel(32, 32);
        assert!(
            center[0] > 230 && center[1] < 15 && center[2] < 15,
            "expected red inside rounded clip at (32,32), got {center:?}"
        );

        let corner = pixel(9, 9);
        assert!(
            corner[0] < 15 && corner[1] < 15 && corner[2] < 15,
            "expected corner pixel (9,9) clipped out on WGPU, got {corner:?}"
        );
    }
}
