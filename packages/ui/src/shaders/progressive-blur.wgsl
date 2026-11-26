// SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov.

fn shade(input: ShaderInput) -> vec4<f32> {
  let coord = select(input.uv.y, 1.0 - input.uv.y, input.params[0].y > 0.5);
  let strength = smoothstep(input.params[0].x, 1.0, coord);
  if (strength <= 0.0) { return vec4<f32>(0.0); }
  let blurred = sample_backdrop(input.uv);
  return vec4<f32>(blurred.rgb, strength);
}
