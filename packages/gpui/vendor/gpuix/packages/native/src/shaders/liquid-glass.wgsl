
fn haus_glass_shape(point: vec2<f32>, half_size: vec2<f32>, radius: f32) -> vec3<f32> {
    let r = max(min(abs(radius), min(half_size.x, half_size.y)), 0.001);
    let extent = r * 1.5286649465560913;
    let blend = clamp((half_size / r - vec2<f32>(1.52866)) / -0.52866, vec2<f32>(0.0), vec2<f32>(1.0));
    let normal_extent = mix(extent, r, max(blend.x, blend.y));
    let corner = abs(point) - half_size + vec2<f32>(normal_extent);
    let q = max((abs(point) - half_size + vec2<f32>(extent)) / extent, vec2<f32>(0.0));
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
    let point_sign = vec2<f32>(
        select(-1.0, 1.0, point.x >= 0.0),
        select(-1.0, 1.0, point.y >= 0.0),
    );
    return vec3<f32>(dist, n_dir * point_sign);
}

fn haus_apply_saturation(col: vec3<f32>, sat: f32) -> vec3<f32> {
    let luma = dot(col, vec3<f32>(0.2126, 0.7152, 0.0722));
    return mix(vec3<f32>(luma), col, sat);
}

fn haus_rim_band(
    distance_inside: f32,
    height: f32,
    curvature: f32,
    angular: f32,
    amount: f32,
    aa_width: f32,
) -> f32 {
    let x = clamp(distance_inside / height, 0.0, 1.0);
    let step_falloff = select(0.0, 1.0, x < 1.0);
    let falloff = mix(step_falloff, 1.0 - x, curvature);
    let band_cov = clamp(distance_inside / aa_width + 0.5, 0.0, 1.0)
        * clamp((height - distance_inside) / aa_width + 0.5, 0.0, 1.0);
    let a = falloff * band_cov * angular;
    let bias = 1.0 / max(amount, 0.001) - 2.0;
    return a / max(1.0 + bias * (1.0 - a), 0.0001);
}

fn haus_glass_rim(distance_inside: f32, outward_normal: vec2<f32>, aa_width: f32) -> f32 {
    let facing = abs(outward_normal.y);
    let spread = cos(1.523526992886717);
    let diffuse_spread = cos(0.9902925090802006);
    let angular = clamp((facing - spread) / (1.0 - spread), 0.0, 1.0);
    let diffuse_angular = clamp((facing - diffuse_spread) / (1.0 - diffuse_spread), 0.0, 1.0);
    let aa = max(aa_width, 0.0001);
    return haus_rim_band(distance_inside, 1.0, 0.75, angular, 0.5, aa)
        + haus_rim_band(distance_inside, 8.0, 1.0, diffuse_angular, 0.07500000298023224, aa);
}

fn haus_glass_rim_composite(material: vec3<f32>, intensity: f32, is_dark: f32) -> vec3<f32> {
    let dark_light = vec3<f32>(
        dot(material, vec3<f32>(1.09375, -0.357666015625, -0.0360107421875)),
        dot(material, vec3<f32>(-0.1063232421875, 0.84228515625, -0.036102294921875)),
        dot(material, vec3<f32>(-0.10638427734375, -0.357421875, 1.1640625)),
    ) + vec3<f32>(0.25);
    let light_light = vec3<f32>(
        dot(material, vec3<f32>(1.2626953125, -0.238525390625, -0.0240020751953125)),
        dot(material, vec3<f32>(-0.07080078125, 1.0947265625, -0.0240936279296875)),
        dot(material, vec3<f32>(-0.0709228515625, -0.23828125, 1.3095703125)),
    ) + vec3<f32>(0.199951171875);
    let light = clamp(mix(light_light, dark_light, is_dark), vec3<f32>(-0.75), vec3<f32>(1.0));
    return mix(material, light, intensity);
}

fn shade(input: ShaderInput) -> vec4<f32> {
    let sz = max(input.size, vec2<f32>(1.0));
    let half_size = sz * 0.5;
    let p = (input.uv - vec2<f32>(0.5)) * sz;

    var quad_radius = select(input.corner_radii.z, input.corner_radii.y, p.y < 0.0);
    if p.x < 0.0 {
        quad_radius = select(input.corner_radii.w, input.corner_radii.x, p.y < 0.0);
    }
    let explicit_radius = input.params[0].x;
    let corner_r = select(quad_radius, explicit_radius, explicit_radius > 0.0);

    let shape = haus_glass_shape(p, half_size, corner_r);
    let sdf = shape.x;
    let inside = -sdf;
    let aa = 1.0 / max(input.scale_factor, 1.0);
    let aa_mask = 1.0 - smoothstep(-aa * 0.5, aa * 0.5, sdf);
    if aa_mask <= 0.001 {
        return vec4<f32>(0.0);
    }

    let bevel_width = input.params[0].y;
    let ior = max(input.params[0].z, 1.05);
    let refraction_dial = input.params[0].w;
    let dispersion = input.params[1].x;
    let saturation = input.params[1].y;
    let specular_dial = input.params[1].z;
    let edge_highlight = input.params[1].w;
    let darkened_edge = input.params[2].x;
    let native_rim = input.params[2].y;
    let tint_opacity = clamp(input.params[2].z, 0.0, 1.0);
    let is_dark = clamp(input.params[2].w, 0.0, 1.0);

    let z_r = max(bevel_width, 4.0);
    let norm_p = clamp(p / max(half_size, vec2<f32>(1.0)), vec2<f32>(-1.0), vec2<f32>(1.0));
    let n_edge = normalize(shape.yz + vec2<f32>(0.0001));
    let n_corner = normalize(norm_p + vec2<f32>(0.0001));
    let n_out = normalize(n_edge * 0.85 + n_corner * 0.15);

    // Snell's law optical convex bevel refraction along perimeter bevel (inside < z_r).
    let u = clamp(1.0 - (inside / z_r), 0.0, 1.0);
    let sin_i = u * 0.98;
    let theta_i = asin(sin_i);
    let theta_t = asin(clamp(sin_i / ior, -0.999, 0.999));
    let snell_dev = tan(theta_i - theta_t) * 1.29253;

    let inner_fade = smoothstep(0.0, 1.5, z_r - inside);
    let disp_edge = snell_dev * inner_fade;

    let edge_amount = min(z_r * 1.25, 20.0) * refraction_dial;
    let refr = -n_out * (disp_edge * edge_amount);
    let chroma = -n_out * (disp_edge * 3.5 * dispersion);

    let uv_r = clamp((p + half_size + refr + chroma) / sz, vec2<f32>(0.0), vec2<f32>(1.0));
    let uv_g = clamp((p + half_size + refr) / sz, vec2<f32>(0.0), vec2<f32>(1.0));
    let uv_b = clamp((p + half_size + refr - chroma) / sz, vec2<f32>(0.0), vec2<f32>(1.0));

    let frosted = vec3<f32>(
        sample_backdrop(uv_r).r,
        sample_backdrop(uv_g).g,
        sample_backdrop(uv_b).b,
    );

    var col = haus_apply_saturation(frosted, saturation);
    col = mix(col, input.colors[0].rgb, tint_opacity);

    // GPUI screen space is y-down, so top-left key light points along (+0.7071, +0.7071).
    let l_key = vec2<f32>(0.7071, 0.7071);
    let l_fill = vec2<f32>(-0.7071, -0.7071);
    let a_key = clamp(dot(-n_out, l_key) + 0.35, 0.0, 1.0);
    let a_fill = clamp(dot(-n_out, l_fill) + 0.15, 0.0, 1.0) * 0.25;
    let edge_dist = max(inside, 0.0);
    let hairline_diff = (edge_dist - 0.45) / 0.35;
    let hairline = exp(-(hairline_diff * hairline_diff));
    let total_hl = hairline * (a_key * 0.42 + a_fill * 0.15) * specular_dial;
    let rim_diff = (edge_dist - 0.65) / 1.1;
    let edge_rim = exp(-(rim_diff * rim_diff)) * (a_key * 0.65 + a_fill * 0.25 + 0.18) * edge_highlight;
    let dark_diff = (edge_dist - 0.85) / 1.4;
    let dark_rim = exp(-(dark_diff * dark_diff)) * darkened_edge;

    var fin = col * (1.0 - dark_rim);
    if native_rim > 0.5 {
        let rim_light = haus_glass_rim(edge_dist, n_edge, aa);
        fin = haus_glass_rim_composite(fin, rim_light, is_dark);
    } else {
        fin += (vec3<f32>(1.0) - col) * min(total_hl + edge_rim, 0.95);
    }

    fin += vec3<f32>((interleaved_noise(input.frag_coord) - 0.5) / 255.0);
    return vec4<f32>(clamp(fin, vec3<f32>(0.0), vec3<f32>(1.0)), aa_mask);
}
