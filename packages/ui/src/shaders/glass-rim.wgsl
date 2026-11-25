// SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov.
// Analytical continuous-corner specular + 8pt diffuse glass rim shader (1:1 macOS / GNOME / Electron).

fn rim_shape_sdf(p: vec2<f32>, half_size: vec2<f32>, radius: f32) -> vec3<f32> {
    let r = max(min(abs(radius), min(half_size.x, half_size.y)), 0.0001);
    let extent = r * 1.5286649465560913;
    let blend = clamp((half_size / r - vec2<f32>(1.52866)) / -0.52866, vec2<f32>(0.0), vec2<f32>(1.0));
    let normal_extent = mix(extent, r, max(blend.x, blend.y));
    let corner = abs(p) - half_size + vec2<f32>(normal_extent);
    let q = max((abs(p) - half_size + vec2<f32>(extent)) / extent, vec2<f32>(0.0));
    let major = max(q.x, q.y);
    let minor = min(q.x, q.y);
    let t = select(0.0, clamp(minor / major, 0.0, 1.0), major > 0.0);
    let polynomial = (((3.1560099124908447 - t * 0.9260540008544922) * t
        - 3.6412200927734375) * t + 1.268030047416687) * t + 0.2685309946537018;
    let magnitude = length(q);
    let continuous = magnitude + 1.0 - 1.0 / (1.0 - t * t * clamp(magnitude, 0.0, 1.0) * polynomial);
    let circular = length(max(q * 1.5286649465560913 - vec2<f32>(0.5286650061607361), vec2<f32>(0.0)))
        * 0.6541655659675598 + 0.3458344340324402;
    let orientation = select(-1.0, 1.0, q.y > q.x);
    let weight = clamp(0.5 - orientation + orientation * t, 0.0, 1.0);
    let distances = mix(vec2<f32>(continuous), vec2<f32>(circular), blend);
    let dist = (mix(distances.x, distances.y, weight) - 1.0) * extent
        + min(max(corner.x, corner.y), 0.0);
    let n_raw = max(corner, vec2<f32>(0.0));
    let n_len = length(n_raw);
    let fallback_n = select(vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 0.0), corner.x > corner.y);
    let n_dir = select(fallback_n, n_raw / max(n_len, 0.0001), n_len > 0.0);
    let p_sign = vec2<f32>(select(-1.0, 1.0, p.x >= 0.0), select(-1.0, 1.0, p.y >= 0.0));
    return vec3<f32>(dist, n_dir * p_sign);
}

fn rim_round_rect_normal(p: vec2<f32>, half_size: vec2<f32>, radii: vec4<f32>) -> vec2<f32> {
    var rad = select(radii.z, radii.y, p.y < 0.0);
    if p.x < 0.0 {
        rad = select(radii.w, radii.x, p.y < 0.0);
    }
    let corner = abs(p) - half_size + vec2<f32>(rad);
    let n_raw = max(corner, vec2<f32>(0.0));
    let n_len = length(n_raw);
    let fallback = select(vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 0.0), corner.x > corner.y);
    let n_dir = select(fallback, n_raw / max(n_len, 0.0001), n_len > 0.0);
    let p_sign = vec2<f32>(select(-1.0, 1.0, p.x >= 0.0), select(-1.0, 1.0, p.y >= 0.0));
    return n_dir * p_sign;
}

fn rim_band(dist_in: f32, height: f32, curv: f32, ang: f32, amount: f32, aa: f32) -> f32 {
    let x = clamp(dist_in / height, 0.0, 1.0);
    let falloff = mix(select(0.0, 1.0, x < 1.0), 1.0 - x, curv);
    let cov = clamp(dist_in / aa + 0.5, 0.0, 1.0) * clamp((height - dist_in) / aa + 0.5, 0.0, 1.0);
    let a = falloff * cov * ang;
    let bias = 1.0 / max(amount, 0.001) - 2.0;
    return a / max(1.0 + bias * (1.0 - a), 0.0001);
}

fn rim_intensity(dist_in: f32, normal_y: f32, aa: f32) -> f32 {
    let facing = abs(normal_y);
    let spread = cos(1.523526992886717);
    let diff_spread = cos(0.9902925090802006);
    let ang = clamp((facing - spread) / (1.0 - spread), 0.0, 1.0);
    let diff_ang = clamp((facing - diff_spread) / (1.0 - diff_spread), 0.0, 1.0);
    return rim_band(dist_in, 1.0, 0.75, ang, 0.5, aa)
        + rim_band(dist_in, 8.0, 1.0, diff_ang, 0.07500000298023224, aa);
}

fn rim_vibrancy_composite(mat: vec3<f32>, intensity: f32, is_dark: f32) -> vec3<f32> {
    let dark_l = vec3<f32>(
        dot(mat, vec3<f32>(1.09375, -0.357666015625, -0.0360107421875)),
        dot(mat, vec3<f32>(-0.1063232421875, 0.84228515625, -0.036102294921875)),
        dot(mat, vec3<f32>(-0.10638427734375, -0.357421875, 1.1640625)),
    ) + vec3<f32>(0.25);
    let light_l = vec3<f32>(
        dot(mat, vec3<f32>(1.2626953125, -0.238525390625, -0.0240020751953125)),
        dot(mat, vec3<f32>(-0.07080078125, 1.0947265625, -0.0240936279296875)),
        dot(mat, vec3<f32>(-0.0709228515625, -0.23828125, 1.3095703125)),
    ) + vec3<f32>(0.199951171875);
    let light = clamp(mix(light_l, dark_l, is_dark), vec3<f32>(-0.75), vec3<f32>(1.0));
    return clamp(mix(mat, light, intensity), vec3<f32>(0.0), vec3<f32>(1.0));
}

fn linear_pos(uv: vec2<f32>, angle_deg: f32) -> f32 {
    let rad = radians(angle_deg);
    let dir = vec2<f32>(sin(rad), -cos(rad));
    let denom = max(abs(dir.x) + abs(dir.y), 1e-4);
    return clamp(dot(uv - vec2<f32>(0.5), dir) / denom + 0.5, 0.0, 1.0);
}

fn radial_t(uv: vec2<f32>, center: vec2<f32>, stop_frac: f32) -> f32 {
    let far = max(center, vec2<f32>(1.0) - center) * max(stop_frac, 0.05);
    return clamp(length((uv - center) / far), 0.0, 1.0);
}

fn hue_rotate_rgb(col: vec3<f32>, deg: f32) -> vec3<f32> {
    let a = radians(deg);
    let c = cos(a);
    let s = sin(a);
    let k = vec3<f32>(0.577350269);
    let rotated = col * c + cross(k, col) * s + k * dot(k, col) * (1.0 - c);
    return clamp(rotated, vec3<f32>(0.0), vec3<f32>(1.0));
}

fn adjust_color(col: vec3<f32>, hue_deg: f32, sat: f32, bright: f32) -> vec3<f32> {
    var out = hue_rotate_rgb(col, hue_deg);
    let luma = dot(out, vec3<f32>(0.2126, 0.7152, 0.0722));
    out = mix(vec3<f32>(luma), out, sat);
    return clamp(out * bright, vec3<f32>(0.0), vec3<f32>(1.0));
}

fn kf2(a: f32, b: f32, t: f32, ta: f32, tb: f32) -> f32 {
    let u = smoothstep(0.0, 1.0, clamp((t - ta) / max(tb - ta, 1e-4), 0.0, 1.0));
    return mix(a, b, u);
}

fn shade(input: ShaderInput) -> vec4<f32> {
    let sz = max(input.size, vec2<f32>(1.0));
    let half_size = sz * 0.5;
    let p = (input.uv - vec2<f32>(0.5)) * sz;
    let radius = input.params[0].x;
    let is_dark = clamp(input.params[0].y, 0.0, 1.0);
    let strength = input.params[0].z;
    let opacity = input.params[0].w;
    let ref_plate = input.params[1].x;
    let mode = i32(round(input.params[1].y));
    let motion_id = i32(round(input.params[1].z));
    let variant = i32(round(input.params[1].w));
    let circular = input.params[2].x > 0.5;
    let reduced_motion = input.params[2].y > 0.5;
    let continuous = input.params[2].z > 0.5;

    var sdf = input.distance;
    var n_edge = rim_round_rect_normal(p, half_size, input.corner_radii);
    if circular {
        let rad = max(min(abs(radius), min(half_size.x, half_size.y)), 0.001);
        let lp = length(p);
        sdf = lp - rad;
        n_edge = select(vec2<f32>(0.0, 1.0), p / max(lp, 1e-4), lp > 1e-4);
    } else if continuous {
        let s = rim_shape_sdf(p, half_size, radius);
        sdf = s.x;
        n_edge = s.yz;
    }

    let aa = 1.0 / max(input.scale_factor, 1.0);
    let aa_mask = 1.0 - smoothstep(-aa * 0.5, aa * 0.5, sdf);
    let dist_in = -sdf;
    if aa_mask <= 0.001 || dist_in > 9.5 {
        return vec4<f32>(0.0);
    }

    let rim = rim_intensity(max(dist_in, 0.0), n_edge.y, aa);
    var light_a = 0.0;
    if rim > 0.0 {
        let comp = rim_vibrancy_composite(vec3<f32>(ref_plate), rim, is_dark);
        let lum = (comp.r + comp.g + comp.b) / 3.0;
        let inv_headroom = 1.0 / max(0.08, 1.0 - ref_plate);
        light_a = clamp(max(0.0, lum - ref_plate) * inv_headroom * strength, 0.0, 1.0);
    }

    var dark_a = 0.0;
    if dist_in >= 0.0 && dist_in <= 1.1 {
        let side = abs(n_edge.x);
        if side > 0.78 {
            dark_a = clamp(1.0 - dist_in / 1.1, 0.0, 1.0) * ((side - 0.78) / 0.22) * mix(0.095, 0.08, is_dark) * strength;
        }
    }
    let mask_a = clamp(light_a + dark_a * (1.0 - light_a), 0.0, 1.0);
    if mask_a <= 0.001 {
        return vec4<f32>(0.0);
    }

    var rgb = vec3<f32>(clamp(light_a / mask_a, 0.0, 1.0));
    var fx_op = 1.0;

    if mode == 1 {
        let c = input.colors[0].rgb;
        let is_panel = variant == 1;
        let angle = select(155.0, 165.0, is_panel);
        let lt = linear_pos(input.uv, angle);
        let s0 = mix(c, vec3<f32>(1.0), select(0.34, 0.38, is_panel));
        let s1 = mix(c, vec3<f32>(1.0), select(0.60, 0.64, is_panel));
        let s2 = mix(c, vec3<f32>(1.0), select(0.44, 0.48, is_panel));
        var lin = select(mix(s1, s2, clamp((lt - 0.52) / 0.48, 0.0, 1.0)), mix(s0, s1, clamp(lt / 0.52, 0.0, 1.0)), lt <= 0.52);
        let rc = select(vec2<f32>(0.12, 0.10), vec2<f32>(0.50, 0.00), is_panel);
        let rt = radial_t(input.uv, rc, 0.78);
        let r0 = mix(c, vec3<f32>(1.0), select(0.24, 0.28, is_panel));
        let r1 = mix(c, vec3<f32>(1.0), select(0.48, 0.56, is_panel));
        let rad_col = select(r1, mix(r0, r1, clamp(rt / 0.59, 0.0, 1.0)), rt <= 0.59);
        let rad_a = select(clamp(1.0 - (rt - 0.59) / 0.41, 0.0, 1.0), 1.0, rt <= 0.59);
        rgb = mix(lin, rad_col, rad_a);
    } else if mode == 2 {
        let c1 = input.colors[0].rgb;
        let c2 = input.colors[1].rgb;
        let c3 = input.colors[2].rgb;
        let is_panel = variant == 1;
        let lt = linear_pos(input.uv, select(145.0, 160.0, is_panel));
        let l1 = mix(c1, vec3<f32>(1.0), select(0.30, 0.34, is_panel));
        let l2 = mix(c2, vec3<f32>(1.0), select(0.38, 0.44, is_panel));
        let l3 = mix(c3, vec3<f32>(1.0), select(0.32, 0.36, is_panel));
        var col = select(mix(l2, l3, (lt - 0.5) * 2.0), mix(l1, l2, lt * 2.0), lt <= 0.5);
        let d3 = radial_t(input.uv, select(vec2<f32>(0.52, 0.94), vec2<f32>(0.50, 0.96), is_panel), 0.66);
        col = mix(col, mix(c3, vec3<f32>(1.0), select(0.22, 0.28, is_panel)), 1.0 - d3);
        let d2 = radial_t(input.uv, select(vec2<f32>(0.86, 0.24), vec2<f32>(0.78, 0.14), is_panel), select(0.62, 0.60, is_panel));
        col = mix(col, mix(c2, vec3<f32>(1.0), select(0.24, 0.26, is_panel)), 1.0 - d2);
        let d1 = radial_t(input.uv, select(vec2<f32>(0.14, 0.12), vec2<f32>(0.24, 0.06), is_panel), select(0.60, 0.58, is_panel));
        rgb = mix(col, mix(c1, vec3<f32>(1.0), select(0.18, 0.22, is_panel)), 1.0 - d1);

        if !reduced_motion && motion_id > 0 {
            if motion_id == 1 {
                let t = fract(input.time / 8.4);
                var op = 0.72; var hue = -4.0; var sat = 1.0; var br = 0.97;
                if t < 0.34 { op = kf2(0.72, 0.9, t, 0.0, 0.34); hue = kf2(-4.0, 6.0, t, 0.0, 0.34); sat = kf2(1.0, 1.1, t, 0.0, 0.34); br = kf2(0.97, 1.07, t, 0.0, 0.34); }
                else if t < 0.62 { op = kf2(0.9, 0.78, t, 0.34, 0.62); hue = kf2(6.0, -2.0, t, 0.34, 0.62); sat = kf2(1.1, 1.02, t, 0.34, 0.62); br = kf2(1.07, 1.0, t, 0.34, 0.62); }
                else if t < 0.82 { op = kf2(0.78, 0.92, t, 0.62, 0.82); hue = kf2(-2.0, 8.0, t, 0.62, 0.82); sat = kf2(1.02, 1.12, t, 0.62, 0.82); br = kf2(1.0, 1.09, t, 0.62, 0.82); }
                else { op = kf2(0.92, 0.72, t, 0.82, 1.0); hue = kf2(8.0, -4.0, t, 0.82, 1.0); sat = kf2(1.12, 1.0, t, 0.82, 1.0); br = kf2(1.09, 0.97, t, 0.82, 1.0); }
                fx_op = op / 0.82; rgb = adjust_color(rgb, hue, sat, br);
            } else if motion_id == 2 {
                let s = 0.5 - 0.5 * cos(input.time * 6.2831853 / 7.2);
                fx_op = mix(0.62, 0.9, s) / 0.82; rgb = adjust_color(rgb, 0.0, 1.0, mix(0.95, 1.08, s));
            } else if motion_id == 3 {
                rgb = adjust_color(rgb, fract(input.time / 16.0) * 360.0, 1.0, 1.0);
            } else if motion_id == 4 {
                let ph = fract(input.time / 26.0);
                let t = select((1.0 - ph) * 2.0, ph * 2.0, ph <= 0.5);
                var op = 0.74; var hue = -12.0; var sat = 1.04; var br = 1.0;
                if t < 0.5 { op = kf2(0.74, 0.9, t, 0.0, 0.5); hue = kf2(-12.0, 14.0, t, 0.0, 0.5); sat = kf2(1.04, 1.14, t, 0.0, 0.5); br = kf2(1.0, 1.06, t, 0.0, 0.5); }
                else { op = kf2(0.9, 0.8, t, 0.5, 1.0); hue = kf2(14.0, 22.0, t, 0.5, 1.0); sat = kf2(1.14, 1.08, t, 0.5, 1.0); br = kf2(1.06, 1.0, t, 0.5, 1.0); }
                fx_op = op / 0.82; rgb = adjust_color(rgb, hue, sat, br);
            } else if motion_id == 5 {
                let ph = fract(input.time / 19.0);
                let t = select((1.0 - ph) * 2.0, ph * 2.0, ph <= 0.5);
                var op = 0.7; var hue = -8.0; var br = 0.96;
                if t < 0.5 { op = kf2(0.7, 0.88, t, 0.0, 0.5); hue = kf2(-8.0, 10.0, t, 0.0, 0.5); br = kf2(0.96, 1.07, t, 0.0, 0.5); }
                else { op = kf2(0.88, 0.76, t, 0.5, 1.0); hue = kf2(10.0, -4.0, t, 0.5, 1.0); br = kf2(1.07, 1.0, t, 0.5, 1.0); }
                fx_op = op / 0.82; rgb = adjust_color(rgb, hue, 1.0, br);
            } else if motion_id == 6 {
                let t = fract(input.time / 6.8);
                var op = 0.76; var br = 0.97;
                if t < 0.36 { op = kf2(0.76, 1.0, t, 0.0, 0.36); br = kf2(0.97, 1.1, t, 0.0, 0.36); }
                else if t < 0.66 { op = kf2(1.0, 0.84, t, 0.36, 0.66); br = kf2(1.1, 1.01, t, 0.36, 0.66); }
                else if t < 0.86 { op = kf2(0.84, 0.98, t, 0.66, 0.86); br = kf2(1.01, 1.08, t, 0.66, 0.86); }
                else { op = kf2(0.98, 0.76, t, 0.86, 1.0); br = kf2(1.08, 0.97, t, 0.86, 1.0); }
                fx_op = op / 0.82; rgb = adjust_color(rgb, 0.0, 1.0, br);
            } else if motion_id == 7 {
                let t = fract(input.time / 3.8);
                var op = 0.66; var sat = 1.0; var br = 0.96;
                if t < 0.25 { op = kf2(0.66, 0.92, t, 0.0, 0.25); sat = kf2(1.0, 1.1, t, 0.0, 0.25); br = kf2(0.96, 1.12, t, 0.0, 0.25); }
                else if t < 0.5 { op = kf2(0.92, 0.74, t, 0.25, 0.5); sat = kf2(1.1, 1.0, t, 0.25, 0.5); br = kf2(1.12, 0.99, t, 0.25, 0.5); }
                else if t < 0.75 { op = kf2(0.74, 0.9, t, 0.5, 0.75); sat = kf2(1.0, 1.08, t, 0.5, 0.75); br = kf2(0.99, 1.1, t, 0.5, 0.75); }
                else { op = kf2(0.9, 0.66, t, 0.75, 1.0); sat = kf2(1.08, 1.0, t, 0.75, 1.0); br = kf2(1.1, 0.96, t, 0.75, 1.0); }
                fx_op = op / 0.82; rgb = adjust_color(rgb, 0.0, sat, br);
            }
        }
    }

    if mode > 0 && is_dark > 0.5 {
        rgb = mix(rgb, vec3<f32>(1.0), light_a * 0.14);
    }
    rgb = clamp(dither(rgb, input.frag_coord), vec3<f32>(0.0), vec3<f32>(1.0));
    let final_a = clamp(mask_a * opacity * fx_op * aa_mask, 0.0, 1.0);
    return vec4<f32>(rgb, final_a);
}
