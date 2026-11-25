
@group(0) @binding(1) var gpui_backdrop_tex: texture_2d<f32>;
@group(0) @binding(2) var gpui_backdrop_sampler: sampler;
var<private> gpui_current_bounds_origin: vec2<f32>;
var<private> gpui_current_bounds_size: vec2<f32>;

/// Sample the composited backdrop at normalized element `uv` (0..1 within element bounds).
fn sample_backdrop(uv: vec2<f32>) -> vec4<f32> {
    let clamped_uv = clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0));
    let screen_px = gpui_current_bounds_origin + clamped_uv * gpui_current_bounds_size;
    let tex_uv = clamp(
        screen_px / max(gpui_globals.viewport_size, vec2<f32>(1.0)),
        vec2<f32>(0.0),
        vec2<f32>(1.0),
    );
    return textureSampleLevel(gpui_backdrop_tex, gpui_backdrop_sampler, tex_uv, 0.0);
}

/// Sample the composited backdrop at an absolute device-pixel coordinate.
fn sample_backdrop_screen(device_pos: vec2<f32>) -> vec4<f32> {
    let tex_uv = clamp(
        device_pos / max(gpui_globals.viewport_size, vec2<f32>(1.0)),
        vec2<f32>(0.0),
        vec2<f32>(1.0),
    );
    return textureSampleLevel(gpui_backdrop_tex, gpui_backdrop_sampler, tex_uv, 0.0);
}
