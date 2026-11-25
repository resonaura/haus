fn shade(input: ShaderInput) -> vec4<f32> {
    if input.distance > 0.5 {
        return vec4<f32>(0.0);
    }
    let bg = sample_backdrop(input.uv + vec2<f32>(0.01, -0.01));
    return vec4<f32>(mix(bg.rgb, input.colors[0].rgb, 0.25), 1.0);
}
