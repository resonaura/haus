
fn haus_grad_mix_stop(a: vec4<f32>, b: vec4<f32>, t: f32, use_oklab: bool) -> vec4<f32> {
    if use_oklab {
        return vec4<f32>(mix_oklab(a.rgb, b.rgb, t), mix(a.a, b.a, t));
    }
    return mix(a, b, t);
}

fn shade(input: ShaderInput) -> vec4<f32> {
    let mode = input.params[1].x;
    let angle_rad = input.params[1].y;
    let stop_count = input.params[1].z;
    let use_oklab = input.params[1].w > 0.5;
    let center = input.params[2].xy;
    let radii = max(input.params[2].zw, vec2<f32>(1e-4));

    var t = 0.0;
    if mode < 0.5 {
        let dir = vec2<f32>(sin(angle_rad), -cos(angle_rad));
        let denom = max(abs(dir.x) + abs(dir.y), 1e-4);
        t = clamp(dot(input.uv - vec2<f32>(0.5), dir) / denom + 0.5, 0.0, 1.0);
    } else if mode < 1.5 {
        t = clamp(length((input.uv - center) / radii), 0.0, 1.0);
    } else {
        let delta = input.uv - center;
        let angle = atan2(delta.x, -delta.y) - angle_rad;
        t = fract(angle / 6.28318530718);
    }

    let p0 = input.params[0].x;
    let p1 = input.params[0].y;
    let p2 = input.params[0].z;
    let p3 = input.params[0].w;

    var color = input.colors[0];
    if stop_count > 1.5 {
        if t <= p0 {
            color = input.colors[0];
        } else if t <= p1 {
            let local = clamp((t - p0) / max(p1 - p0, 1e-4), 0.0, 1.0);
            color = haus_grad_mix_stop(input.colors[0], input.colors[1], local, use_oklab);
        } else if stop_count > 2.5 && t <= p2 {
            let local = clamp((t - p1) / max(p2 - p1, 1e-4), 0.0, 1.0);
            color = haus_grad_mix_stop(input.colors[1], input.colors[2], local, use_oklab);
        } else if stop_count > 3.5 && t <= p3 {
            let local = clamp((t - p2) / max(p3 - p2, 1e-4), 0.0, 1.0);
            color = haus_grad_mix_stop(input.colors[2], input.colors[3], local, use_oklab);
        } else if stop_count > 3.5 {
            color = input.colors[3];
        } else if stop_count > 2.5 {
            color = input.colors[2];
        } else {
            color = input.colors[1];
        }
    }

    let rgb = clamp(dither(color.rgb, input.frag_coord), vec3<f32>(0.0), vec3<f32>(1.0));
    let aa_mask = coverage(input.distance, input.scale_factor);
    return vec4<f32>(rgb, saturate(color.a) * aa_mask);
}
