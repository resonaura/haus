// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright © 2026 Andrii Vynohradov. All rights reserved.
// Haus Liquid Glass optical refraction, prism dispersion, and rim highlight fragment shader.

precision highp float;

uniform sampler2D u_backdrop;
uniform vec2 u_resolution;
uniform float u_scale;
uniform float u_ior;
uniform float u_corner_radius;
uniform float u_bevel_width;
uniform float u_refraction_dial;
uniform float u_dispersion;
uniform float u_saturation;
uniform float u_edge_highlight;
uniform float u_specular_dial;
uniform float u_darkened_edge;
uniform float u_native_rim;
uniform vec4 u_tint_color;
uniform float u_tint_opacity;
uniform float u_is_dark;

in vec2 v_uv;
out vec4 fragColor;

#include "./glass-rim.glsl"
#include "./continuous-corner.glsl"

vec3 applySaturation(vec3 col, float s) {
    float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
    return mix(vec3(luma), col, s);
}

float ign(vec2 fc) {
    return fract(52.9829189 * fract(dot(fc, vec2(0.06711056, 0.00583715))));
}

void main() {
    vec2 sz = u_resolution;
    vec2 halfSize = sz * 0.5;
    vec2 p = (v_uv - 0.5) * sz;

    vec3 shape = hausGlassShape(p, halfSize, u_corner_radius);
    float sdf = shape.x;
    vec2 sdfGradient = shape.yz;
    float inside = -sdf;

    float aa = max(1.0, length(sdfGradient));
    float aaMask = 1.0 - smoothstep(-aa * 0.5, aa * 0.5, sdf);
    if (aaMask <= 0.001) {
        fragColor = vec4(0.0);
        return;
    }

    float scale = max(u_scale, 1.0);
    float zR = max(u_bevel_width, 4.0 * scale);

    vec2 normP = clamp(p / max(halfSize, vec2(1.0)), vec2(-1.0), vec2(1.0));
    vec2 nEdge = normalize(sdfGradient + vec2(0.0001));
    vec2 nCorner = normalize(normP + vec2(0.0001));
    vec2 nOut = normalize(nEdge * 0.85 + nCorner * 0.15);

    // Snell's law optical lens refraction strictly along the perimeter bevel (inside < zR)
    float u = clamp(1.0 - (inside / zR), 0.0, 1.0);
    float sinI = u * 0.98;
    float thetaI = asin(sinI);
    float thetaT = asin(sinI / max(u_ior, 1.05));
    float snellDev = tan(thetaI - thetaT) * 1.29253;

    float innerFade = smoothstep(0.0, 1.5 * scale, zR - inside);
    float dispEdge = snellDev * innerFade;

    float edgeAmount = min(zR * 1.25, 20.0 * scale) * u_refraction_dial;
    vec2 refr = -nOut * (dispEdge * edgeAmount);

    // Chromatic dispersion strictly on the prism bevel
    vec2 chroma = -nOut * (dispEdge * 3.5 * scale * u_dispersion);
    vec2 center = halfSize;
    vec2 uvR = clamp((p + center + refr + chroma) / sz, 0.0, 1.0);
    vec2 uvG = clamp((p + center + refr)          / sz, 0.0, 1.0);
    vec2 uvB = clamp((p + center + refr - chroma) / sz, 0.0, 1.0);

    vec3 frostedCol = vec3(
        texture(u_backdrop, uvR).r,
        texture(u_backdrop, uvG).g,
        texture(u_backdrop, uvB).b
    );

    vec3 col = applySaturation(frostedCol, u_saturation);
    col = mix(col, u_tint_color.rgb, u_tint_opacity);

    vec2 lKey = vec2(0.7071, -0.7071);
    vec2 lFill = vec2(-0.7071, 0.7071);
    float aKey = clamp(dot(-nOut, lKey) + 0.35, 0.0, 1.0);
    float aFill = clamp(dot(-nOut, lFill) + 0.15, 0.0, 1.0) * 0.25;
    float edgeDist = inside / scale;
    float hairline = exp(-pow((edgeDist - 0.45) / 0.35, 2.0));
    float totalHl = hairline * (aKey * 0.42 + aFill * 0.15) * u_specular_dial;

    vec3 fin = col + (vec3(1.0) - col) * totalHl;
    if (u_native_rim > 0.5) {
        float rimLight = hausGlassRim(edgeDist, nEdge, aa / scale);
        fin = hausGlassRimComposite(col, rimLight, u_is_dark);
    }

    fin += (ign(gl_FragCoord.xy) - 0.5) / 255.0;
    fragColor = vec4(clamp(fin, 0.0, 1.0) * aaMask, aaMask);
}
