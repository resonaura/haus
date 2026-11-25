//! Native GPU compositor wiring for GPUIX: analytical Liquid Glass WGSL,
//! multi-stop linear/radial/conic gradients, 2D affine transforms, squircles,
//! alpha edge fade masks, glow bloom, and custom user WGSL shaders.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use crate::color::parse_color_rgba;
use crate::style::{
    BackgroundValue, CustomShaderDesc, GlowDesc, GradientValue, LinearGradientStopValue,
    LiquidGlassDesc, StyleDesc, TransformDesc,
};

const LIQUID_GLASS_GPUI_WGSL: &str = include_str!("shaders/liquid-glass.wgsl");

const GRADIENT_GPUI_WGSL: &str = include_str!("shaders/gradient.wgsl");

static LIQUID_GLASS_SHADER: OnceLock<Result<gpui::Shader, String>> = OnceLock::new();
static GRADIENT_SHADER: OnceLock<Result<gpui::Shader, String>> = OnceLock::new();
static CUSTOM_SHADER_CACHE: OnceLock<
    Mutex<HashMap<(String, String, bool, bool), Result<gpui::Shader, String>>>,
> = OnceLock::new();

pub(crate) fn liquid_glass_shader() -> Option<gpui::Shader> {
    LIQUID_GLASS_SHADER
        .get_or_init(|| {
            gpui::Shader::new(
                gpui::ShaderSource::new("haus.liquid-glass.v1", LIQUID_GLASS_GPUI_WGSL)
                    .samples_backdrop(true)
                    .custom_shape_alpha(true),
            )
            .map_err(|error| {
                let message = error.to_string();
                log::error!("Failed to compile built-in Liquid Glass shader: {message}");
                message
            })
        })
        .as_ref()
        .ok()
        .copied()
}

pub(crate) fn gradient_shader() -> Option<gpui::Shader> {
    GRADIENT_SHADER
        .get_or_init(|| {
            gpui::Shader::new(
                gpui::ShaderSource::new("haus.gradient.v1", GRADIENT_GPUI_WGSL)
                    .custom_shape_alpha(true),
            )
            .map_err(|error| {
                let message = error.to_string();
                log::error!("Failed to compile built-in gradient shader: {message}");
                message
            })
        })
        .as_ref()
        .ok()
        .copied()
}

fn compile_custom_shader(desc: &CustomShaderDesc) -> Option<gpui::Shader> {
    let cache = CUSTOM_SHADER_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let key = (
        desc.label.clone(),
        desc.wgsl.clone(),
        desc.samples_backdrop,
        desc.custom_shape_alpha,
    );
    let mut guard = cache.lock().unwrap();
    if let Some(entry) = guard.get(&key) {
        return entry.as_ref().ok().copied();
    }
    let result = gpui::Shader::new(
        gpui::ShaderSource::new(desc.label.clone(), desc.wgsl.clone())
            .samples_backdrop(desc.samples_backdrop)
            .custom_shape_alpha(desc.custom_shape_alpha),
    )
    .map_err(|error| {
        let message = error.to_string();
        log::warn!("Invalid custom WGSL shader `{}`: {message}", desc.label);
        message
    });
    let compiled = result.as_ref().ok().copied();
    guard.insert(key, result);
    compiled
}

/// Result of decomposing a `TransformDesc` (explicit fields + optional 2x3 matrix).
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct ResolvedTransform2D {
    pub scale_x: f32,
    pub scale_y: f32,
    pub rotate_rad: f32,
    pub skew_x_rad: f32,
    pub skew_y_rad: f32,
    pub translate_x: f32,
    pub translate_y: f32,
}

impl Default for ResolvedTransform2D {
    fn default() -> Self {
        Self {
            scale_x: 1.0,
            scale_y: 1.0,
            rotate_rad: 0.0,
            skew_x_rad: 0.0,
            skew_y_rad: 0.0,
            translate_x: 0.0,
            translate_y: 0.0,
        }
    }
}

fn decompose_css_matrix(matrix: [f64; 6]) -> ResolvedTransform2D {
    let [a, b, c, d, tx, ty] = [
        matrix[0] as f32,
        matrix[1] as f32,
        matrix[2] as f32,
        matrix[3] as f32,
        matrix[4] as f32,
        matrix[5] as f32,
    ];
    let sx = a.hypot(b);
    if sx > 1e-6 {
        let cos_r = a / sx;
        let sin_r = b / sx;
        let rotate_rad = b.atan2(a);
        let k = cos_r * c + sin_r * d;
        let sy = -sin_r * c + cos_r * d;
        let skew_x_rad = if sy.abs() > 1e-6 {
            (k / sy).atan()
        } else {
            0.0
        };
        ResolvedTransform2D {
            scale_x: sx,
            scale_y: sy,
            rotate_rad,
            skew_x_rad,
            skew_y_rad: 0.0,
            translate_x: tx,
            translate_y: ty,
        }
    } else {
        let sy = c.hypot(d);
        ResolvedTransform2D {
            scale_x: 0.0,
            scale_y: sy,
            rotate_rad: if sy > 1e-6 { (-c).atan2(d) } else { 0.0 },
            skew_x_rad: 0.0,
            skew_y_rad: 0.0,
            translate_x: tx,
            translate_y: ty,
        }
    }
}

pub(crate) fn resolve_transform_2d(transform: &TransformDesc) -> ResolvedTransform2D {
    let base = transform
        .matrix
        .map(decompose_css_matrix)
        .unwrap_or_default();
    let uniform_scale = transform.scale.unwrap_or(1.0) as f32;
    let explicit_sx = transform.scale_x.unwrap_or(1.0) as f32;
    let explicit_sy = transform.scale_y.unwrap_or(1.0) as f32;
    let scale_x = base.scale_x * uniform_scale * explicit_sx;
    let scale_y = base.scale_y * uniform_scale * explicit_sy;

    let sanitize_finite = |v: f32, fallback: f32| if v.is_finite() { v } else { fallback };
    ResolvedTransform2D {
        scale_x: sanitize_finite(scale_x, 1.0),
        scale_y: sanitize_finite(scale_y, 1.0),
        rotate_rad: sanitize_finite(
            base.rotate_rad + (transform.rotate.unwrap_or(0.0) as f32).to_radians(),
            0.0,
        ),
        skew_x_rad: sanitize_finite(
            base.skew_x_rad + (transform.skew_x.unwrap_or(0.0) as f32).to_radians(),
            0.0,
        ),
        skew_y_rad: sanitize_finite(
            base.skew_y_rad + (transform.skew_y.unwrap_or(0.0) as f32).to_radians(),
            0.0,
        ),
        translate_x: sanitize_finite(
            base.translate_x + transform.translate_x.unwrap_or(0.0) as f32,
            0.0,
        ),
        translate_y: sanitize_finite(
            base.translate_y + transform.translate_y.unwrap_or(0.0) as f32,
            0.0,
        ),
    }
}

fn push_glow_shadows(glow: &GlowDesc, out: &mut Vec<gpui::BoxShadow>) {
    let Some(base) = parse_color_rgba(&glow.color) else {
        return;
    };
    let radius = (glow.radius.max(0.0) as f32).min(200.0);
    let spread = glow.spread.unwrap_or(0.0) as f32;
    let intensity = (glow.intensity.unwrap_or(1.0) as f32).clamp(0.0, 2.0);
    if (radius <= 0.0 && spread <= 0.0) || intensity <= 0.0 {
        return;
    }

    // Layer two soft concentric halos so bright UI glows bloom smoothly instead of banding.
    let layers = [(0.55, 0.55, 0.65), (1.0, 1.0, 0.45)];
    for (r_mul, s_mul, alpha_mul) in layers {
        let mut color = base;
        color.a = (color.a * intensity * alpha_mul).clamp(0.0, 1.0);
        let built = gpui::BoxShadow::new(gpui::px(0.0), gpui::px(0.0), color.into())
            .blur_radius(gpui::px((radius * r_mul).max(0.0)))
            .spread_radius(gpui::px(spread * s_mul));
        out.push(if glow.inset { built.inset() } else { built });
    }
}

pub(crate) fn collect_box_shadows(style: &StyleDesc) -> Vec<gpui::BoxShadow> {
    let mut shadows = Vec::new();
    if let Some(ref box_shadows) = style.box_shadow {
        for shadow in box_shadows.as_slice() {
            let Some(color) = parse_color_rgba(&shadow.color) else {
                continue;
            };
            let built = gpui::BoxShadow::new(
                gpui::px(shadow.offset_x as f32),
                gpui::px(shadow.offset_y as f32),
                color.into(),
            )
            .blur_radius(gpui::px(shadow.blur_radius.max(0.0) as f32))
            .spread_radius(gpui::px(shadow.spread_radius as f32));
            shadows.push(if shadow.inset { built.inset() } else { built });
        }
    }
    if let Some(ref glow) = style.glow {
        push_glow_shadows(glow, &mut shadows);
    }
    shadows
}

pub(crate) fn apply_compositor_styles<E: gpui::Styled>(mut el: E, style: &StyleDesc) -> E {
    if let Some(smoothing) = style.corner_smoothing {
        if smoothing.is_finite() {
            el = el.corner_smoothing((smoothing as f32).clamp(0.0, 1.0));
        }
    }
    if let Some(blur) = style.backdrop_blur {
        if blur.is_finite() && blur > 0.0 {
            el = el.backdrop_blur(gpui::px((blur as f32).clamp(0.0, 96.0)));
        }
    }
    if let Some(blur) = style.blur {
        if blur.is_finite() && blur > 0.0 {
            el = el.blur(gpui::px((blur as f32).clamp(0.0, 96.0)));
        }
    }
    if let Some(ref mask) = style.mask {
        let top = mask.fade_top.unwrap_or(0.0).max(0.0) as f32;
        let bottom = mask.fade_bottom.unwrap_or(0.0).max(0.0) as f32;
        let left = mask.fade_left.unwrap_or(0.0).max(0.0) as f32;
        let right = mask.fade_right.unwrap_or(0.0).max(0.0) as f32;
        if top > 0.0 || bottom > 0.0 {
            el = el.fade_edges(gpui::px(top), gpui::px(bottom));
        }
        if left > 0.0 || right > 0.0 {
            el = el.fade_sides(gpui::px(left), gpui::px(right));
        }
    }
    if let Some(ref transform) = style.transform {
        let resolved = resolve_transform_2d(transform);
        if resolved.scale_x != 1.0 || resolved.scale_y != 1.0 {
            el = el.layer_scale_xy(resolved.scale_x, resolved.scale_y);
        }
        if resolved.rotate_rad != 0.0 {
            el = el.layer_rotate(resolved.rotate_rad);
        }
        if resolved.skew_x_rad != 0.0 || resolved.skew_y_rad != 0.0 {
            el = el.layer_skew(resolved.skew_x_rad, resolved.skew_y_rad);
        }
        if resolved.translate_x != 0.0 || resolved.translate_y != 0.0 {
            el = el.layer_translate(gpui::point(
                gpui::px(resolved.translate_x),
                gpui::px(resolved.translate_y),
            ));
        }
    }
    if let Some(ref origin) = style.transform_origin {
        if origin.x.is_finite() && origin.y.is_finite() {
            el = el.layer_scale_origin(gpui::point(
                (origin.x as f32).clamp(0.0, 1.0),
                (origin.y as f32).clamp(0.0, 1.0),
            ));
        }
    }
    let shadows = collect_box_shadows(style);
    if !shadows.is_empty() {
        el = el.shadow(shadows);
    }
    el
}

fn sample_four_stops(stops: &[LinearGradientStopValue]) -> Vec<&LinearGradientStopValue> {
    if stops.len() <= 4 {
        return stops.iter().collect();
    }
    let last = stops.len() - 1;
    let i1 = (last / 3).max(1);
    let i2 = ((last * 2) / 3).max(i1 + 1).min(last - 1);
    vec![&stops[0], &stops[i1], &stops[i2], &stops[last]]
}

fn build_gradient_instance(
    gradient: &GradientValue,
    style: &StyleDesc,
) -> Option<(gpui::Shader, gpui::ShaderInstance)> {
    let (mode, angle_deg, stops, color_space, center_x, center_y, radius_x, radius_y) =
        match gradient {
            GradientValue::LinearGradient {
                angle,
                stops,
                color_space,
            } => {
                if stops.len() == 2 {
                    return None;
                }
                (0.0f32, *angle as f32, stops.as_slice(), color_space.as_deref(), 0.5, 0.5, 0.5, 0.5)
            }
            GradientValue::RadialGradient {
                stops,
                center_x,
                center_y,
                radius_x,
                radius_y,
                color_space,
            } => (
                1.0f32,
                0.0f32,
                stops.as_slice(),
                color_space.as_deref(),
                center_x.unwrap_or(0.5) as f32,
                center_y.unwrap_or(0.5) as f32,
                radius_x.unwrap_or(0.5).max(0.001) as f32,
                radius_y.unwrap_or(0.5).max(0.001) as f32,
            ),
            GradientValue::ConicGradient {
                angle,
                stops,
                center_x,
                center_y,
                color_space,
            } => (
                2.0f32,
                angle.unwrap_or(0.0) as f32,
                stops.as_slice(),
                color_space.as_deref(),
                center_x.unwrap_or(0.5) as f32,
                center_y.unwrap_or(0.5) as f32,
                0.5f32,
                0.5f32,
            ),
        };
    if stops.is_empty() {
        return None;
    }

    let shader = gradient_shader()?;
    let sampled = sample_four_stops(stops);
    let mut instance = gpui::ShaderInstance::default()
        .corner_smoothing(style.corner_smoothing.unwrap_or(0.0) as f32);
    for (idx, stop) in sampled.iter().enumerate() {
        let color = parse_color_rgba(&stop.color)?;
        instance.colors[idx] = color.into();
        instance.params[idx] = (stop.position as f32).clamp(0.0, 1.0);
    }
    let use_oklab = match color_space {
        Some("oklab") => 1.0,
        _ => 0.0,
    };
    instance.params[4] = mode;
    instance.params[5] = angle_deg.to_radians();
    instance.params[6] = sampled.len() as f32;
    instance.params[7] = use_oklab;
    instance.params[8] = center_x;
    instance.params[9] = center_y;
    instance.params[10] = radius_x;
    instance.params[11] = radius_y;
    instance.params[12] = style.corner_smoothing.unwrap_or(0.0) as f32;
    Some((shader, instance))
}

pub(crate) fn build_liquid_glass_instance(
    desc: &LiquidGlassDesc,
    style: &StyleDesc,
    time_secs: f32,
) -> Option<(gpui::Shader, gpui::ShaderInstance)> {
    if desc.enabled == Some(false) {
        return None;
    }
    let shader = liquid_glass_shader()?;
    let is_dark = desc.is_dark.unwrap_or(true);
    let default_tint = if is_dark {
        gpui::Rgba {
            r: 0.1,
            g: 0.1,
            b: 0.12,
            a: 1.0,
        }
    } else {
        gpui::Rgba {
            r: 0.98,
            g: 0.98,
            b: 1.0,
            a: 1.0,
        }
    };
    let tint = desc
        .tint_color
        .as_deref()
        .and_then(parse_color_rgba)
        .unwrap_or(default_tint);
    let blur_radius = (desc.blur_radius.unwrap_or(20.0).clamp(0.0, 64.0)) as f32;
    let corner_radius = desc
        .corner_radius
        .or(style.border_radius)
        .unwrap_or(0.0)
        .max(0.0) as f32;
    let bevel_width = (desc.bevel_width.unwrap_or(13.28).clamp(4.0, 48.0)) as f32;
    let ior = (desc.ior.unwrap_or(1.5).clamp(1.05, 2.5)) as f32;
    let refraction_dial = (desc.refraction_strength.unwrap_or(0.85).clamp(0.0, 2.0)) as f32;
    let dispersion = (desc.dispersion.unwrap_or(0.025).clamp(0.0, 2.0)) as f32;
    let saturation = (desc.saturation.unwrap_or(1.25).clamp(0.0, 3.0)) as f32;
    let specular_dial = (desc.specular_dial.unwrap_or(0.65).clamp(0.0, 2.0)) as f32;
    let edge_highlight = (desc.edge_highlight.unwrap_or(0.35).clamp(0.0, 2.0)) as f32;
    let darkened_edge = (desc.darkened_edge.unwrap_or(0.0).clamp(0.0, 0.5)) as f32;
    let native_rim = if desc.native_rim.unwrap_or(true) {
        1.0
    } else {
        0.0
    };
    let tint_opacity = (desc
        .tint_opacity
        .unwrap_or(if is_dark { 0.34 } else { 0.28 })
        .clamp(0.0, 1.0)) as f32;

    let instance = gpui::ShaderInstance::at(time_secs)
        .backdrop_blur(gpui::px(blur_radius))
        .corner_smoothing(style.corner_smoothing.unwrap_or(1.0) as f32)
        .color(0, tint)
        .params(
            0,
            &[
                corner_radius,
                bevel_width,
                ior,
                refraction_dial,
                dispersion,
                saturation,
                specular_dial,
                edge_highlight,
                darkened_edge,
                native_rim,
                tint_opacity,
                if is_dark { 1.0 } else { 0.0 },
            ],
        );
    Some((shader, instance))
}

fn build_custom_shader_instance(
    desc: &CustomShaderDesc,
    style: &StyleDesc,
    time_secs: f32,
) -> Option<(gpui::Shader, gpui::ShaderInstance)> {
    let shader = compile_custom_shader(desc)?;
    let mut instance = gpui::ShaderInstance::at(desc.time.map(|t| t as f32).unwrap_or(time_secs))
        .corner_smoothing(style.corner_smoothing.unwrap_or(0.0) as f32);
    if let Some(blur) = desc.backdrop_blur_radius {
        if blur.is_finite() && blur > 0.0 {
            instance = instance.backdrop_blur(gpui::px((blur as f32).clamp(0.0, 64.0)));
        }
    }
    if let Some(ref params) = desc.params {
        for (idx, value) in params.iter().take(gpui::SHADER_PARAM_COUNT).enumerate() {
            if value.is_finite() {
                instance.params[idx] = *value as f32;
            }
        }
    }
    if let Some(ref colors) = desc.colors {
        for (idx, hex) in colors.iter().take(gpui::SHADER_COLOR_COUNT).enumerate() {
            if let Some(rgba) = parse_color_rgba(hex) {
                instance.colors[idx] = rgba.into();
            }
        }
    }
    Some((shader, instance))
}

pub(crate) fn apply_background_shaders<E: gpui::InteractiveElement>(
    mut el: E,
    style: &StyleDesc,
    time_secs: f32,
) -> E {
    if style.background_color.is_none() {
        if let Some(BackgroundValue::Gradient(ref gradient)) = style.background {
            if let Some((shader, instance)) = build_gradient_instance(gradient, style) {
                el = el.paint_background_shader(shader, instance);
            }
        }
    }
    if let Some(ref glass) = style.liquid_glass {
        if let Some((shader, instance)) = build_liquid_glass_instance(glass, style, time_secs) {
            el = el.paint_background_shader(shader, instance);
        }
    }
    if let Some(ref custom) = style.shader {
        if let Some((shader, instance)) = build_custom_shader_instance(custom, style, time_secs) {
            el = el.paint_background_shader(shader, instance);
        }
    }
    el
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn liquid_glass_and_gradient_shaders_translate_cleanly() {
        let glass = liquid_glass_shader().expect("Liquid Glass shader compiles");
        assert!(glass.samples_backdrop());
        assert!(glass.custom_shape_alpha());
        let glass_prog = gpui::shader_program(glass.id()).unwrap();
        assert!(glass_prog.module().is_ok());
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        {
            let msl = glass_prog.to_msl().expect("Liquid Glass translates to MSL");
            assert!(msl.source.contains("gpui_backdrop_tex"));
        }
        #[cfg(target_os = "windows")]
        {
            let hlsl = glass_prog.to_hlsl().expect("Liquid Glass translates to HLSL");
            assert!(hlsl.source.contains("register(t3)"));
        }

        let grad = gradient_shader().expect("Gradient shader compiles");
        assert!(!grad.samples_backdrop());
        assert!(grad.custom_shape_alpha());
        let grad_prog = gpui::shader_program(grad.id()).unwrap();
        assert!(grad_prog.module().is_ok());
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        assert!(grad_prog.to_msl().is_ok());
        #[cfg(target_os = "windows")]
        assert!(grad_prog.to_hlsl().is_ok());
    }

    #[test]
    fn matrix_qr_decomposition_roundtrips_with_gpui_filter_matrix() {
        let cases = [
            (2.0f32, 1.5f32, 25.0f32.to_radians(), 0.0f32),
            (1.2, 0.8, -42.0f32.to_radians(), 18.0f32.to_radians()),
            (-1.0, 1.0, 15.0f32.to_radians(), 0.0),
            (0.75, -1.25, 110.0f32.to_radians(), -12.0f32.to_radians()),
        ];

        for (sx, sy, rot, skx) in cases {
            let filter = gpui::Filter {
                scale_x: sx,
                scale_y: sy,
                rotate_rad: rot,
                skew_x_rad: skx,
                ..Default::default()
            };
            let forward = filter.forward_matrix();
            let css_matrix = [
                forward[0][0] as f64,
                forward[1][0] as f64,
                forward[0][1] as f64,
                forward[1][1] as f64,
                14.5,
                -22.25,
            ];
            let decomposed = resolve_transform_2d(&TransformDesc {
                translate_x: None,
                translate_y: None,
                scale: None,
                scale_x: None,
                scale_y: None,
                rotate: None,
                skew_x: None,
                skew_y: None,
                matrix: Some(css_matrix),
            });
            let reconstructed = gpui::Filter {
                scale_x: decomposed.scale_x,
                scale_y: decomposed.scale_y,
                rotate_rad: decomposed.rotate_rad,
                skew_x_rad: decomposed.skew_x_rad,
                skew_y_rad: decomposed.skew_y_rad,
                ..Default::default()
            }
            .forward_matrix();

            for r in 0..2 {
                for c in 0..2 {
                    assert!(
                        (forward[r][c] - reconstructed[r][c]).abs() < 1e-4,
                        "mismatch at [{r}][{c}]: {} vs {}",
                        forward[r][c],
                        reconstructed[r][c]
                    );
                }
            }
            assert!((decomposed.translate_x - 14.5).abs() < 1e-4);
            assert!((decomposed.translate_y + 22.25).abs() < 1e-4);
        }
    }

    #[test]
    fn liquid_glass_packs_uniforms_and_backdrop_blur() {
        let desc = LiquidGlassDesc {
            enabled: Some(true),
            blur_radius: Some(24.0),
            corner_radius: Some(18.0),
            bevel_width: Some(12.0),
            ior: Some(1.45),
            refraction_strength: Some(0.9),
            dispersion: Some(0.05),
            saturation: Some(1.4),
            specular_dial: Some(0.75),
            edge_highlight: Some(0.5),
            darkened_edge: Some(0.04),
            native_rim: Some(true),
            tint_color: Some("#112233".into()),
            tint_opacity: Some(0.32),
            is_dark: Some(true),
        };
        let (shader, instance) =
            build_liquid_glass_instance(&desc, &StyleDesc::default(), 1.5).unwrap();
        assert!(shader.samples_backdrop());
        assert_eq!(instance.time, 1.5);
        assert_eq!(instance.backdrop_blur_radius, gpui::px(24.0));
        assert_eq!(instance.params[0], 18.0);
        assert_eq!(instance.params[1], 12.0);
        assert!((instance.params[2] - 1.45).abs() < 1e-5);
        assert!((instance.params[10] - 0.32).abs() < 1e-5);
    }

    #[test]
    fn custom_shape_shader_without_backdrop_translates_cleanly() {
        let desc = CustomShaderDesc {
            label: "haus.glass-rim.test".into(),
            wgsl: "fn shade(input: ShaderInput) -> vec4<f32> { let a = 1.0 - smoothstep(-1.0, 1.0, input.distance); return vec4<f32>(input.colors[0].rgb, a * input.params[0].w); }".into(),
            samples_backdrop: false,
            custom_shape_alpha: true,
            animated: true,
            backdrop_blur_radius: None,
            time: None,
            params: Some(vec![25.0, 1.0, 0.92, 0.76]),
            colors: Some(vec!["#ffcc2e".into()]),
        };
        let (shader, instance) =
            build_custom_shader_instance(&desc, &StyleDesc::default(), 2.25).unwrap();
        assert!(!shader.samples_backdrop());
        assert!(shader.custom_shape_alpha());
        assert_eq!(instance.time, 2.25);
        assert!((instance.params[3] - 0.76).abs() < 1e-5);
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        {
            let prog = gpui::shader_program(shader.id()).unwrap();
            assert!(prog.to_msl().is_ok());
        }
    }
}
