fn shade(input: ShaderInput) -> vec4<f32> {
    let tone = bayer(vec2<u32>(input.frag_coord), 3u) * 0.1 + value_noise(input.uv * 4.0);
    let color = mix_oklab(input.colors[0].rgb, input.colors[1].rgb, input.uv.x + tone);
    return vec4<f32>(dither(color, input.frag_coord), 1.0);
}
