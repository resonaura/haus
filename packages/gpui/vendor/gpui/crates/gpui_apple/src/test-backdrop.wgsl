fn shade(input: ShaderInput) -> vec4<f32> {
    let bg = sample_backdrop(input.uv);
    return vec4<f32>(bg.g, bg.r, bg.b, 1.0);
}
