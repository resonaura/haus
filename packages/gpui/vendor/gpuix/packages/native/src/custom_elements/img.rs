/// Image custom elements for raster images and tintable SVG icons.
///
/// Decodes `data:`, filesystem path, and `http(s):` images through a bounded,
/// ref-counted image cache (`DecodedImageCache`) instead of GPUI's unbounded
/// global `loading_assets` map, and explicitly calls `window.drop_image(...)`
/// when frames leave the screen or exceed idle caps. Preserves the previous
/// decoded frame while the next source decodes (no black flash) and supports
/// native GPU cross-fading via `transitionMs`.
use super::img_cache::{
    decode_data_url_to_render_image, new_shared_cache, DecodedImageCache, ImageCacheKey,
    ImageSourceKind, SharedImgCache,
};
use super::{CustomElement, CustomElementFactory, CustomRenderContext};
use base64::Engine as _;
use std::sync::Arc;
use web_time::Instant;

pub struct ImgFactory {
    cache: SharedImgCache,
}

impl ImgFactory {
    pub fn new(cache: SharedImgCache) -> Self {
        Self { cache }
    }
}

pub struct SvgFactory;

impl CustomElementFactory for SvgFactory {
    fn element_type(&self) -> &str {
        "svg"
    }

    fn create(&self, _id: u64) -> Box<dyn CustomElement> {
        Box::new(SvgElement::default())
    }
}

impl CustomElementFactory for ImgFactory {
    fn element_type(&self) -> &str {
        "img"
    }

    fn create(&self, _id: u64) -> Box<dyn CustomElement> {
        Box::new(ImgElement::new(self.cache.clone()))
    }
}

#[derive(Debug, Clone, Default)]
enum ImgObjectFit {
    Fill,
    #[default]
    Contain,
    Cover,
    ScaleDown,
    None,
}

impl ImgObjectFit {
    fn from_str(value: &str) -> Self {
        match value {
            "fill" => Self::Fill,
            "cover" => Self::Cover,
            "scaleDown" => Self::ScaleDown,
            "none" => Self::None,
            _ => Self::Contain,
        }
    }

    fn as_gpui(&self) -> gpui::ObjectFit {
        match self {
            Self::Fill => gpui::ObjectFit::Fill,
            Self::Contain => gpui::ObjectFit::Contain,
            Self::Cover => gpui::ObjectFit::Cover,
            Self::ScaleDown => gpui::ObjectFit::ScaleDown,
            Self::None => gpui::ObjectFit::None,
        }
    }
}

type AsyncImageOutcome =
    Arc<parking_lot::Mutex<Option<std::result::Result<Arc<gpui::RenderImage>, String>>>>;

enum LoadRequest {
    DataUrl(String),
    Path(std::path::PathBuf),
    Uri(gpui::SharedUri),
}

struct PendingLoad {
    key: ImageCacheKey,
    request: Option<LoadRequest>,
    result: AsyncImageOutcome,
    task: Option<gpui::Task<()>>,
}

struct ActiveImg {
    key: Option<ImageCacheKey>,
    image: Arc<gpui::RenderImage>,
}

struct CrossfadeImg {
    active: ActiveImg,
    started_at: Instant,
    duration_ms: u32,
}

pub struct ImgElement {
    cache: SharedImgCache,
    src_raw_key: Option<ImageCacheKey>,
    displayed: Option<ActiveImg>,
    previous: Option<CrossfadeImg>,
    pending: Option<PendingLoad>,
    empty_src: bool,
    load_failed: bool,
    transition_ms: u32,
    object_fit: ImgObjectFit,
    alt: String,
    destroyed: bool,
}

impl Default for ImgElement {
    fn default() -> Self {
        Self::new(new_shared_cache())
    }
}

impl Drop for ImgElement {
    fn drop(&mut self) {
        if !self.destroyed {
            self.release_all();
        }
    }
}

impl ImgElement {
    pub fn new(cache: SharedImgCache) -> Self {
        Self {
            cache,
            src_raw_key: None,
            displayed: None,
            previous: None,
            pending: None,
            empty_src: false,
            load_failed: false,
            transition_ms: 0,
            object_fit: ImgObjectFit::default(),
            alt: String::new(),
            destroyed: false,
        }
    }

    fn release_active(cache: &mut DecodedImageCache, active: ActiveImg) {
        if let Some(key) = active.key {
            cache.release(&key);
        } else {
            cache.queue_drop(active.image);
        }
    }

    fn release_all(&mut self) {
        self.pending = None;
        let mut cache = self.cache.borrow_mut();
        if let Some(prev) = self.previous.take() {
            Self::release_active(&mut cache, prev.active);
        }
        if let Some(curr) = self.displayed.take() {
            Self::release_active(&mut cache, curr);
        }
        self.destroyed = true;
    }

    fn apply_loaded_image(
        &mut self,
        key: Option<ImageCacheKey>,
        image: Arc<gpui::RenderImage>,
        cx: &gpui::App,
    ) {
        self.load_failed = false;
        self.empty_src = false;
        let previous_displayed = self.displayed.take();
        if let Some(old) = previous_displayed {
            if self.transition_ms > 0 && !cx.reduce_motion() {
                if let Some(stale) = self.previous.take() {
                    let mut cache = self.cache.borrow_mut();
                    Self::release_active(&mut cache, stale.active);
                }
                self.previous = Some(CrossfadeImg {
                    active: old,
                    started_at: Instant::now(),
                    duration_ms: self.transition_ms,
                });
            } else {
                let mut cache = self.cache.borrow_mut();
                Self::release_active(&mut cache, old);
            }
        }
        self.displayed = Some(ActiveImg { key, image });
    }

    fn poll_pending(
        &mut self,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<crate::renderer::GpuixView>,
    ) {
        let Some(pending) = &mut self.pending else {
            return;
        };

        if let Some(request) = pending.request.take() {
            let key = pending.key;
            let cached = self.cache.borrow_mut().acquire(&key);
            if let Some(cached) = cached {
                self.pending = None;
                self.apply_loaded_image(Some(key), cached, cx);
                self.cache.borrow_mut().drain_drops(window);
                return;
            }

            let result_slot = pending.result.clone();
            let bg_task = match request {
                LoadRequest::DataUrl(src) => {
                    let svg_renderer = cx.svg_renderer();
                    cx.background_executor()
                        .spawn(async move { decode_data_url_to_render_image(&src, svg_renderer) })
                }
                LoadRequest::Path(path) => {
                    let resource = gpui::Resource::from(path);
                    let fut = <gpui::ImageAssetLoader as gpui::Asset>::load(resource, cx);
                    cx.background_executor()
                        .spawn(async move { fut.await.map_err(|err| err.to_string()) })
                }
                LoadRequest::Uri(uri) => {
                    let resource = gpui::Resource::Uri(uri);
                    let fut = <gpui::ImageAssetLoader as gpui::Asset>::load(resource, cx);
                    cx.background_executor()
                        .spawn(async move { fut.await.map_err(|err| err.to_string()) })
                }
            };

            pending.task = Some(cx.spawn(async move |view, cx| {
                let outcome = bg_task.await;
                *result_slot.lock() = Some(outcome);
                let _ = view.update(cx, |_, cx| cx.notify());
            }));
            return;
        }

        let maybe_outcome = pending.result.lock().take();
        if let Some(outcome) = maybe_outcome {
            let key = pending.key;
            self.pending = None;
            match outcome {
                Ok(decoded) => {
                    let cached = self.cache.borrow_mut().insert_or_acquire(key, decoded);
                    self.apply_loaded_image(Some(key), cached, cx);
                    self.cache.borrow_mut().drain_drops(window);
                }
                Err(error) => {
                    log::warn!("Failed to load <img> source: {error}");
                    if self.displayed.is_none() {
                        self.load_failed = true;
                    }
                }
            }
        }
    }

    fn advance_crossfade(&mut self, window: &mut gpui::Window) -> Option<f32> {
        let Some(prev) = &self.previous else {
            return None;
        };
        if prev.duration_ms == 0 {
            if let Some(done) = self.previous.take() {
                Self::release_active(&mut self.cache.borrow_mut(), done.active);
                self.cache.borrow_mut().drain_drops(window);
            }
            return None;
        }
        let elapsed_ms = prev.started_at.elapsed().as_secs_f32() * 1000.0;
        if elapsed_ms >= prev.duration_ms as f32 {
            if let Some(done) = self.previous.take() {
                Self::release_active(&mut self.cache.borrow_mut(), done.active);
                self.cache.borrow_mut().drain_drops(window);
            }
            return None;
        }
        let progress = (elapsed_ms / prev.duration_ms as f32).clamp(0.0, 1.0);
        // Smooth ease-out cubic crossfade curve.
        Some(1.0 - (1.0 - progress).powi(3))
    }

    fn load_src(&mut self, src: &str) {
        let src = src.trim();
        if src.is_empty() {
            self.pending = None;
            self.src_raw_key = None;
            self.empty_src = true;
            self.load_failed = false;
            let mut cache = self.cache.borrow_mut();
            if let Some(prev) = self.previous.take() {
                Self::release_active(&mut cache, prev.active);
            }
            if let Some(curr) = self.displayed.take() {
                Self::release_active(&mut cache, curr);
            }
            return;
        }

        let (key, request) = if src.starts_with("data:") {
            (
                ImageCacheKey::new(ImageSourceKind::Data, src),
                LoadRequest::DataUrl(src.to_string()),
            )
        } else if let Some(uri) = http_image_uri(src) {
            (
                ImageCacheKey::new(ImageSourceKind::Uri, src),
                LoadRequest::Uri(uri),
            )
        } else {
            (
                ImageCacheKey::new(ImageSourceKind::Path, src),
                LoadRequest::Path(src.into()),
            )
        };

        if self.src_raw_key == Some(key) && (self.displayed.is_some() || self.pending.is_some()) {
            return;
        }

        self.src_raw_key = Some(key);
        self.empty_src = false;
        self.load_failed = false;
        self.pending = Some(PendingLoad {
            key,
            request: Some(request),
            result: Arc::new(parking_lot::Mutex::new(None)),
            task: None,
        });
    }
}

fn http_image_uri(src: &str) -> Option<gpui::SharedUri> {
    let scheme_end = src.find("://")?;
    let scheme = &src[..scheme_end];
    if !scheme.eq_ignore_ascii_case("http") && !scheme.eq_ignore_ascii_case("https") {
        return None;
    }
    (src.len() > scheme_end + 3).then(|| gpui::SharedUri::from(src.to_string()))
}

/// Install the GPUI HTTP client so `<img src="https://…">` can fetch.
pub fn init(cx: &mut gpui::App) {
    #[cfg(not(target_family = "wasm"))]
    match reqwest_client::ReqwestClient::user_agent("gpuix") {
        Ok(client) => cx.set_http_client(std::sync::Arc::new(client)),
        Err(error) => log::error!(
            "GPUIX HTTP client failed to start; <img src=\"http…\"> will not load: {error:#}"
        ),
    }
    #[cfg(target_family = "wasm")]
    let _ = cx;
}

fn apply_pixel_aspect_ratio<E: gpui::Styled>(mut el: E, style: &crate::style::StyleDesc) -> E {
    // Preserve explicit pixel box ratio over GPUI's intrinsic image aspect override.
    if let (
        Some(crate::style::DimensionValue::Pixels(width)),
        Some(crate::style::DimensionValue::Pixels(height)),
    ) = (style.width.as_ref(), style.height.as_ref())
    {
        if *width > 0.0 && *height > 0.0 {
            el = el.aspect_ratio((*width as f32) / (*height as f32));
        }
    }
    el
}

fn apply_img_corners<E: gpui::Styled>(mut el: E, style: Option<&crate::style::StyleDesc>) -> E {
    let Some(style) = style else {
        return el;
    };
    if let Some(radius) = style.border_radius {
        el = el.rounded(gpui::px(radius as f32));
    }
    if let Some(radius) = style.border_top_left_radius {
        el = el.rounded_tl(gpui::px(radius as f32));
    }
    if let Some(radius) = style.border_top_right_radius {
        el = el.rounded_tr(gpui::px(radius as f32));
    }
    if let Some(radius) = style.border_bottom_left_radius {
        el = el.rounded_bl(gpui::px(radius as f32));
    }
    if let Some(radius) = style.border_bottom_right_radius {
        el = el.rounded_br(gpui::px(radius as f32));
    }
    if let Some(smoothing) = style.corner_smoothing {
        if smoothing.is_finite() {
            el = el.corner_smoothing((smoothing as f32).clamp(0.0, 1.0));
        }
    }
    el
}

fn img_fallback(ctx: &CustomRenderContext, alt: &str, message: &str) -> gpui::AnyElement {
    use gpui::prelude::*;

    let mut fallback = super::custom_surface(
        gpui::div()
            .id(gpui::SharedString::from(format!("__gpuix_img_{}", ctx.id)))
            .flex()
            .items_center()
            .justify_center()
            .bg(gpui::rgba(0x1f2230ff))
            .border(gpui::px(1.0))
            .border_color(gpui::rgba(0x5d6481ff))
            .text_color(gpui::rgba(0xa4accdff)),
        ctx,
    );
    fallback =
        crate::accessibility::apply_accessibility(fallback, ctx.props, Some(gpui::Role::Image));
    fallback = crate::accessibility::apply_image_label(fallback, ctx.props, alt);
    fallback
        .child(ctx.chrome_text(message.to_string(), None))
        .into_any_element()
}

fn img_loading_placeholder(ctx: &CustomRenderContext, alt: &str) -> gpui::AnyElement {
    use gpui::prelude::*;

    let element_id = gpui::SharedString::from(format!("__gpuix_img_{}", ctx.id));
    let mut el = gpui::div().id(element_id);
    if let Some(style) = ctx.style {
        el = crate::renderer::apply_interactive_styles(el, style);
        el = apply_pixel_aspect_ratio(el, style);
    }
    let mut el = crate::accessibility::apply_accessibility(el, ctx.props, Some(gpui::Role::Image));
    el = crate::accessibility::apply_image_label(el, ctx.props, alt);
    let el = super::wire_standard_events(el, ctx);
    crate::automation::track_own_bounds(el, ctx.id).into_any_element()
}

impl CustomElement for ImgElement {
    fn render(
        &mut self,
        ctx: CustomRenderContext,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<crate::renderer::GpuixView>,
    ) -> gpui::AnyElement {
        use gpui::prelude::*;

        self.cache.borrow_mut().drain_drops(window);
        self.poll_pending(window, cx);
        let fade_alpha = self.advance_crossfade(window);

        let Some(current) = &self.displayed else {
            if self.load_failed {
                return img_fallback(&ctx, &self.alt, "img: load failed");
            }
            if self.empty_src {
                return img_fallback(&ctx, &self.alt, "img: no src");
            }
            if self.pending.is_some() {
                return img_loading_placeholder(&ctx, &self.alt);
            }
            return img_fallback(&ctx, &self.alt, "img: no src");
        };

        let element_id = gpui::SharedString::from(format!("__gpuix_img_{}", ctx.id));
        if let (Some(alpha), Some(prev)) = (fade_alpha, &self.previous) {
            window.request_animation_frame();
            let underlay = apply_img_corners(
                gpui::img(prev.active.image.clone())
                    .object_fit(self.object_fit.as_gpui())
                    .absolute()
                    .top_0()
                    .left_0()
                    .size_full(),
                ctx.style,
            );
            let overlay_img = apply_img_corners(
                gpui::img(current.image.clone())
                    .object_fit(self.object_fit.as_gpui())
                    .absolute()
                    .top_0()
                    .left_0()
                    .size_full(),
                ctx.style,
            );
            let mut outer = gpui::div().id(element_id).relative().overflow_hidden();
            if let Some(style) = ctx.style {
                outer = crate::renderer::apply_interactive_styles(outer, style);
                outer = apply_pixel_aspect_ratio(outer, style);
            }
            outer =
                crate::accessibility::apply_accessibility(outer, ctx.props, Some(gpui::Role::Image));
            outer = crate::accessibility::apply_image_label(outer, ctx.props, &self.alt);
            let outer = super::wire_standard_events(outer, &ctx)
                .child(underlay)
                .child(
                    gpui::div()
                        .absolute()
                        .top_0()
                        .left_0()
                        .size_full()
                        .opacity(alpha)
                        .child(overlay_img),
                );
            return crate::automation::track_own_bounds(outer, ctx.id).into_any_element();
        }

        let mut el = gpui::img(current.image.clone())
            .object_fit(self.object_fit.as_gpui())
            .id(element_id);

        if let Some(style) = ctx.style {
            el = crate::renderer::apply_interactive_styles(el, style);
            el = apply_pixel_aspect_ratio(el, style);
        }

        let mut el =
            crate::accessibility::apply_accessibility(el, ctx.props, Some(gpui::Role::Image));
        el = crate::accessibility::apply_image_label(el, ctx.props, &self.alt);
        let el = super::wire_standard_events(el, &ctx);
        crate::automation::track_own_bounds(el, ctx.id).into_any_element()
    }

    fn set_prop(&mut self, key: &str, value: serde_json::Value) {
        match key {
            "src" => {
                if value.is_null() && self.live_image().is_some() {
                    return;
                }
                self.load_src(value.as_str().unwrap_or(""));
            }
            "objectFit" => {
                self.object_fit = value
                    .as_str()
                    .map(ImgObjectFit::from_str)
                    .unwrap_or_default()
            }
            "alt" => self.alt = value.as_str().unwrap_or_default().to_string(),
            "transitionMs" => {
                self.transition_ms = value
                    .as_f64()
                    .filter(|ms| ms.is_finite() && *ms > 0.0)
                    .map(|ms| ms.round().clamp(0.0, 2000.0) as u32)
                    .unwrap_or(0);
            }
            _ => {}
        }
    }

    fn supported_props(&self) -> &'static [&'static str] {
        &["src", "objectFit", "alt", "transitionMs"]
    }

    fn supported_events(&self) -> &'static [&'static str] {
        &["click", "mouseEnter", "mouseLeave", "fileDrop"]
    }

    fn destroy(&mut self) {
        self.release_all();
    }

    fn live_image(&self) -> Option<Arc<gpui::RenderImage>> {
        self.displayed
            .as_ref()
            .filter(|active| active.key.is_none())
            .map(|active| active.image.clone())
    }

    fn take_dropped_image(&mut self) -> Option<Arc<gpui::RenderImage>> {
        None
    }

    fn replace_live_image(
        &mut self,
        image: Arc<gpui::RenderImage>,
    ) -> Option<Arc<gpui::RenderImage>> {
        self.pending = None;
        self.src_raw_key = None;
        self.empty_src = false;
        self.load_failed = false;
        if let Some(prev) = self.previous.take() {
            Self::release_active(&mut self.cache.borrow_mut(), prev.active);
        }
        let old = self.displayed.take();
        self.displayed = Some(ActiveImg { key: None, image });
        match old {
            Some(ActiveImg {
                key: None,
                image: previous_live,
            }) => Some(previous_live),
            Some(cached_active) => {
                Self::release_active(&mut self.cache.borrow_mut(), cached_active);
                None
            }
            None => None,
        }
    }
}

/// Byte order of a packed `setImagePixels` buffer. Alpha is straight in both.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PixelFormat {
    Rgba,
    /// GPUI's own `RenderImage` order, so the upload skips the swizzle pass.
    Bgra,
}

impl PixelFormat {
    pub fn parse(format: Option<&str>) -> std::result::Result<Self, String> {
        match format {
            None | Some("rgba") => Ok(Self::Rgba),
            Some("bgra") => Ok(Self::Bgra),
            Some(other) => Err(format!(
                "Unknown pixel format {other:?}, expected \"rgba\" or \"bgra\""
            )),
        }
    }

    fn name(self) -> &'static str {
        match self {
            Self::Rgba => "RGBA",
            Self::Bgra => "BGRA",
        }
    }
}

pub fn render_image_from_pixels(
    width: u32,
    height: u32,
    mut bytes: Vec<u8>,
    format: PixelFormat,
) -> std::result::Result<Arc<gpui::RenderImage>, String> {
    let name = format.name();
    let expected = (width as u64)
        .checked_mul(height as u64)
        .and_then(|pixels| pixels.checked_mul(4))
        .and_then(|bytes| usize::try_from(bytes).ok())
        .ok_or_else(|| format!("{name} pixel buffer {width}x{height} is too large"))?;
    if bytes.len() != expected {
        return Err(format!(
            "{name} pixel buffer length {} does not match {width}x{height} ({expected} bytes)",
            bytes.len()
        ));
    }
    if format == PixelFormat::Rgba {
        for pixel in bytes.chunks_exact_mut(4) {
            pixel.swap(0, 2);
        }
    }
    gpui::RenderImage::from_bgra(width, height, bytes)
        .map(Arc::new)
        .ok_or_else(|| format!("{name} pixel buffer is not a valid image"))
}

pub fn render_image_from_encoded(
    bytes: Vec<u8>,
    svg_renderer: gpui::SvgRenderer,
) -> std::result::Result<Arc<gpui::RenderImage>, String> {
    let format =
        sniff_image_format(&bytes).ok_or_else(|| "unrecognized image format".to_string())?;
    gpui::Image::from_bytes(format, bytes)
        .to_image_data(svg_renderer)
        .map_err(|error| error.to_string())
}

fn sniff_image_format(bytes: &[u8]) -> Option<gpui::ImageFormat> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        Some(gpui::ImageFormat::Png)
    } else if bytes.starts_with(&[0xFF, 0xD8]) {
        Some(gpui::ImageFormat::Jpeg)
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some(gpui::ImageFormat::Gif)
    } else if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        Some(gpui::ImageFormat::Webp)
    } else if bytes.starts_with(b"BM") {
        Some(gpui::ImageFormat::Bmp)
    } else if bytes.starts_with(&[0x49, 0x49, 0x2A, 0x00])
        || bytes.starts_with(&[0x4D, 0x4D, 0x00, 0x2A])
    {
        Some(gpui::ImageFormat::Tiff)
    } else if bytes.starts_with(&[0x00, 0x00, 0x01, 0x00]) {
        Some(gpui::ImageFormat::Ico)
    } else if bytes.starts_with(b"P1")
        || bytes.starts_with(b"P2")
        || bytes.starts_with(b"P3")
        || bytes.starts_with(b"P4")
        || bytes.starts_with(b"P5")
        || bytes.starts_with(b"P6")
    {
        Some(gpui::ImageFormat::Pnm)
    } else if looks_like_svg(bytes) {
        Some(gpui::ImageFormat::Svg)
    } else {
        None
    }
}

fn looks_like_svg(bytes: &[u8]) -> bool {
    let start = std::str::from_utf8(bytes)
        .ok()
        .map(|text| text.trim_start())
        .unwrap_or("");
    start.starts_with("<svg") || start.starts_with("<?xml")
}

#[derive(Debug, Clone, Default)]
pub struct SvgElement {
    src: String,
    bytes: Option<(Arc<[u8]>, gpui::SharedString)>,
    source: String,
    source_cached: Option<(Arc<[u8]>, gpui::SharedString)>,
    element_id: Option<gpui::SharedString>,
}

fn cache_svg_bytes(bytes: Vec<u8>) -> (Arc<[u8]>, gpui::SharedString) {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    bytes.as_slice().hash(&mut hasher);
    let path = gpui::SharedString::from(format!("__binary_svg__{}", hasher.finish()));
    (Arc::from(bytes), path)
}

impl SvgElement {
    fn load_src(&mut self, src: String) {
        self.bytes = svg_bytes(&src).map(cache_svg_bytes);
        self.src = src;
    }

    fn set_source(&mut self, source: String) {
        self.source_cached = (!source.trim().is_empty())
            .then(|| cache_svg_bytes(source.as_bytes().to_vec()));
        self.source = source;
    }
}

fn svg_bytes(src: &str) -> Option<Vec<u8>> {
    if src.starts_with("data:") {
        let (format, bytes) = decode_image_data_url(src)?;
        return (format == gpui::ImageFormat::Svg).then_some(bytes);
    }
    #[cfg(target_family = "wasm")]
    return None;
    #[cfg(not(target_family = "wasm"))]
    std::fs::read(src).ok()
}

pub(super) fn decode_image_data_url(src: &str) -> Option<(gpui::ImageFormat, Vec<u8>)> {
    let (metadata, data) = src.strip_prefix("data:")?.split_once(',')?;
    let mut parts = metadata.split(';');
    let mime_type = parts.next()?.to_ascii_lowercase();
    let format = gpui::ImageFormat::from_mime_type(&mime_type)?;
    let is_base64 = parts.any(|part| part.eq_ignore_ascii_case("base64"));
    let bytes = if is_base64 {
        base64::engine::general_purpose::STANDARD
            .decode(data)
            .ok()?
    } else {
        percent_decode(data)
    };
    Some((format, bytes))
}

fn percent_decode(input: &str) -> Vec<u8> {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(value) = u8::from_str_radix(
                std::str::from_utf8(&bytes[index + 1..index + 3]).unwrap_or(""),
                16,
            ) {
                out.push(value);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    out
}

impl CustomElement for SvgElement {
    fn render(
        &mut self,
        ctx: CustomRenderContext,
        window: &mut gpui::Window,
        _cx: &mut gpui::Context<crate::renderer::GpuixView>,
    ) -> gpui::AnyElement {
        use gpui::prelude::*;

        let cached = self.source_cached.as_ref().or(self.bytes.as_ref());
        let element_id = self
            .element_id
            .get_or_insert_with(|| gpui::SharedString::from(format!("__gpuix_svg_{}", ctx.id)))
            .clone();
        let Some((data, data_path)) = cached else {
            let empty = super::custom_surface(gpui::div().id(element_id), &ctx);
            return empty.into_any_element();
        };

        let tint = ctx
            .style
            .and_then(|style| style.color.as_deref())
            .and_then(crate::color::parse_color_rgba)
            .unwrap_or_else(|| gpui::rgb(0xe2e2e2).into());
        let mut icon = gpui::svg()
            .data_with_path(data.clone(), data_path.clone())
            .flex_none()
            .text_color(tint)
            .id(element_id);
        if let Some(style) = ctx.style {
            icon = crate::renderer::apply_interactive_styles(icon, style);
        }
        if window.is_a11y_active() {
            icon = crate::accessibility::apply_accessibility(icon, ctx.props, None);
        }
        let icon = super::wire_standard_events(icon, &ctx);
        crate::automation::track_own_bounds(icon, ctx.id).into_any_element()
    }

    fn set_prop(&mut self, key: &str, value: serde_json::Value) {
        match key {
            "src" => self.load_src(value.as_str().unwrap_or_default().to_string()),
            "source" => self.set_source(value.as_str().unwrap_or_default().to_string()),
            _ => {}
        }
    }

    fn supported_props(&self) -> &'static [&'static str] {
        &["src", "source"]
    }

    fn supported_events(&self) -> &'static [&'static str] {
        &["click", "mouseEnter", "mouseLeave", "fileDrop"]
    }

    fn destroy(&mut self) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_render_image(width: u32, height: u32) -> Arc<gpui::RenderImage> {
        let len = (width as usize) * (height as usize) * 4;
        Arc::new(gpui::RenderImage::from_bgra(width, height, vec![255u8; len]).unwrap())
    }

    #[test]
    fn only_http_urls_become_uri_sources() {
        assert!(http_image_uri("https://example.test/a.png").is_some());
        assert!(http_image_uri("HTTP://localhost:9/a.png").is_some());
        assert!(http_image_uri("HTTPS://example.test/a.png").is_some());
        assert!(http_image_uri("/tmp/a.png").is_none());
        assert!(http_image_uri("data:image/png;base64,xx").is_none());
        assert!(http_image_uri("file:///tmp/a.png").is_none());
        assert!(http_image_uri("https://").is_none());
        assert!(http_image_uri("http://").is_none());
    }

    #[test]
    fn preserves_displayed_image_while_next_src_loads() {
        let cache = new_shared_cache();
        let mut el = ImgElement::new(cache.clone());
        let first_key = ImageCacheKey::new(ImageSourceKind::Data, "data:image/jpeg;base64,frame1");
        let first_img = cache
            .borrow_mut()
            .insert_or_acquire(first_key, test_render_image(32, 32));
        el.displayed = Some(ActiveImg {
            key: Some(first_key),
            image: first_img.clone(),
        });
        el.src_raw_key = Some(first_key);

        el.set_prop("src", serde_json::json!("data:image/jpeg;base64,frame2"));
        assert!(el.displayed.is_some());
        assert_eq!(el.displayed.as_ref().unwrap().image.id, first_img.id);
        assert!(el.pending.is_some());
        assert!(!el.empty_src);
        assert!(!el.load_failed);
    }

    #[test]
    fn destroy_releases_displayed_image_to_pending_drops() {
        let cache = new_shared_cache();
        let mut el = ImgElement::new(cache.clone());
        let key = ImageCacheKey::new(ImageSourceKind::Data, "data:image/jpeg;base64,bigframe");
        let img = cache
            .borrow_mut()
            .insert_or_acquire(key, test_render_image(512, 512));
        el.displayed = Some(ActiveImg {
            key: Some(key),
            image: img,
        });
        el.destroy();
        assert_eq!(cache.borrow().len(), 0);
        assert_eq!(cache.borrow().pending_drop_count(), 1);
    }
}
