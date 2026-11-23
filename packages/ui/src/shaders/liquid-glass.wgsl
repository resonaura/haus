// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright © 2026 Andrii Vynohradov. All rights reserved.
// Haus Liquid Glass optical refraction, prism dispersion, and rim highlight WGSL shader.

struct LiquidGlassUniforms {
  resolution: vec2<f32>,
  corner_radius: f32,
  bevel_width: f32,
  ior: f32,
  refraction_dial: f32,
  dispersion: f32,
  saturation: f32,
  specular_dial: f32,
  tint_opacity: f32,
  is_dark: f32,
  tint_color: vec4<f32>,
};

@group(0) @binding(0) var<uniform> u: LiquidGlassUniforms;
@group(0) @binding(1) var backdrop_tex: texture_2d<f32>;
@group(0) @binding(2) var backdrop_sampler: sampler;

fn haus_glass_shape(point: vec2<f32>, half_size: vec2<f32>, radius: f32) -> vec3<f32> {
  let r = max(min(abs(radius), min(half_size.x, half_size.y)), 0.0001);
  let extent = r * 1.5286649465560913;
  let blend = clamp((half_size / r - vec2<f32>(1.52866)) / -0.52866, vec2<f32>(0.0), vec2<f32>(1.0));
  let normal_extent = mix(extent, r, max(blend.x, blend.y));
  let corner = abs(point) - half_size + vec2<f32>(normal_extent);
  let q = max((abs(point) - half_size + vec2<f32>(extent)) / extent, vec2<f32>(0.0));
  let major = max(q.x, q.y);
  let minor = min(q.x, q.y);
  let t = select(0.0, clamp(minor / major, 0.0, 1.0), major > 0.0);
  let poly = (((3.1560099 - t * 0.926054) * t - 3.641220) * t + 1.268030) * t + 0.268531;
  let mag = length(q);
  let continuous = mag + 1.0 - 1.0 / (1.0 - t * t * clamp(mag, 0.0, 1.0) * poly);
  let circular = length(max(q * 1.5286649 - vec2<f32>(0.528665), vec2<f32>(0.0))) * 0.6541656 + 0.3458344;
  let orient = select(-1.0, 1.0, q.y > q.x);
  let weight = clamp(0.5 - orient + orient * t, 0.0, 1.0);
  let dists = mix(vec2<f32>(continuous), vec2<f32>(circular), blend);
  let dist = (mix(dists.x, dists.y, weight) - 1.0) * extent + min(max(corner.x, corner.y), 0.0);
  let n_raw = max(corner, vec2<f32>(0.0));
  let n_len = length(n_raw);
  let fallback_n = select(vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 0.0), corner.x > corner.y);
  let n = select(fallback_n, n_raw / max(n_len, 0.0001), n_len > 0.0) * sign(point);
  return vec3<f32>(dist, n.x, n.y);
}

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let half_size = u.resolution * 0.5;
  let p = (uv - vec2<f32>(0.5)) * u.resolution;
  let shape = haus_glass_shape(p, half_size, u.corner_radius);
  let inside = -shape.x;
  let z_r = max(u.bevel_width, 4.0);
  let norm_p = clamp(p / max(half_size, vec2<f32>(1.0)), vec2<f32>(-1.0), vec2<f32>(1.0));
  let n_edge = normalize(shape.yz + vec2<f32>(0.0001));
  let n_out = normalize(n_edge * 0.85 + normalize(norm_p + vec2<f32>(0.0001)) * 0.15);

  let u_bevel = clamp(1.0 - (inside / z_r), 0.0, 1.0);
  let sin_i = u_bevel * 0.98;
  let snell_dev = tan(asin(sin_i) - asin(sin_i / max(u.ior, 1.05))) * 1.29253;
  let inner_fade = smoothstep(0.0, 1.5, z_r - inside);
  let disp_edge = snell_dev * inner_fade;

  let edge_amount = min(z_r * 1.25, 20.0) * u.refraction_dial;
  let refr = (-n_out * (disp_edge * edge_amount)) / max(u.resolution, vec2<f32>(1.0));
  let chroma = (-n_out * (disp_edge * 3.5 * u.dispersion)) / max(u.resolution, vec2<f32>(1.0));

  let r = textureSample(backdrop_tex, backdrop_sampler, clamp(uv + refr + chroma, vec2<f32>(0.0), vec2<f32>(1.0))).r;
  let g = textureSample(backdrop_tex, backdrop_sampler, clamp(uv + refr, vec2<f32>(0.0), vec2<f32>(1.0))).g;
  let b = textureSample(backdrop_tex, backdrop_sampler, clamp(uv + refr - chroma, vec2<f32>(0.0), vec2<f32>(1.0))).b;
  let frosted = vec3<f32>(r, g, b);
  let luma = dot(frosted, vec3<f32>(0.2126, 0.7152, 0.0722));
  let sat_col = mix(vec3<f32>(luma), frosted, u.saturation);
  let tinted = mix(sat_col, u.tint_color.rgb, u.tint_opacity);
  return vec4<f32>(tinted, 1.0);
}
