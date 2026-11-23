// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright © 2026 Andrii Vynohradov. All rights reserved.
// Continuous cubic-spline rounded rectangle signed distance field.

vec2 hausCurvePoint(vec2 a, vec2 b, vec2 c, vec2 d, float t) {
    float s = 1.0 - t;
    return s * s * s * a + 3.0 * s * s * t * b + 3.0 * s * t * t * c + t * t * t * d;
}

vec3 hausCubicDistance(vec2 p, vec2 a, vec2 b, vec2 c, vec2 d) {
    float t = clamp(dot(p - a, d - a) / max(dot(d - a, d - a), 0.000001), 0.0, 1.0);
    for (int i = 0; i < 5; i++) {
        float s = 1.0 - t;
        vec2 v = hausCurvePoint(a, b, c, d, t) - p;
        vec2 dv = 3.0 * (s * s * (b - a) + 2.0 * s * t * (c - b) + t * t * (d - c));
        vec2 ddv = 6.0 * (s * (c - 2.0 * b + a) + t * (d - 2.0 * c + b));
        float divisor = dot(dv, dv) + dot(v, ddv);
        if (divisor > 0.000001) t = clamp(t - dot(v, dv) / divisor, 0.0, 1.0);
    }
    vec2 v = p - hausCurvePoint(a, b, c, d, t);
    float s = 1.0 - t;
    vec2 tangent = 3.0 * (s * s * (b - a) + 2.0 * s * t * (c - b) + t * t * (d - c));
    vec2 normal = normalize(vec2(tangent.y, -tangent.x));
    return vec3(length(v) * sign(dot(v, normal)), normal);
}

vec3 hausContinuousRect(vec2 p, vec2 halfSize, vec2 radius) {
    vec2 r = min(max(radius, vec2(0.0001)), halfSize);
    vec2 blend = clamp((halfSize / r - 1.52866) / -0.52866, 0.0, 1.0);
    vec2 c0 = mix(vec2(1.528665000000), vec2(1.000000000000), blend);
    vec2 c1 = mix(vec2(1.088490000000), vec2(0.873260235527), blend);
    vec2 c2 = mix(vec2(0.868407000000), vec2(0.747675688574), blend);
    vec2 c3 = mix(vec2(0.631494000000), vec2(0.629933766426), blend);
    vec2 c4 = mix(vec2(0.372824000000), vec2(0.374765864212), blend);
    vec2 c5 = mix(vec2(0.169060000000), vec2(0.172639921429), blend);
    vec2 c6 = mix(vec2(0.074911400000), vec2(0.070994627159), blend);
    vec2 c7 = mix(vec2(0.000000000000), vec2(0.024092519876), blend);
    vec2 c8 = vec2(0.0);
    vec2 c9 = vec2(0.0);
    vec2 q = halfSize - abs(p);
    vec2 extent = r * vec2(c0.x, c0.y);
    if (q.x >= extent.x || q.y >= extent.y) {
        return q.x < q.y ? vec3(-q.x, 1.0, 0.0) : vec3(-q.y, 0.0, 1.0);
    }
    vec2 a = r * vec2(c9.y, c0.y);
    vec2 b = r * vec2(c8.y, c1.y);
    vec2 c = r * vec2(c7.y, c2.y);
    vec2 d = r * vec2(c6.y, c3.y);
    vec2 e = r * vec2(c5.y, c4.y);
    vec2 f = r * vec2(c4.x, c5.y);
    vec2 g = r * vec2(c3.x, c6.x);
    vec2 h = r * vec2(c2.x, c7.x);
    vec2 j = r * vec2(c1.x, c8.x);
    vec2 k = r * vec2(c0.x, c9.x);
    vec3 one = hausCubicDistance(q, a, b, c, d);
    vec3 two = hausCubicDistance(q, d, e, f, g);
    vec3 three = hausCubicDistance(q, g, h, j, k);
    vec3 nearest = abs(one.x) < abs(two.x) ? one : two;
    nearest = abs(nearest.x) < abs(three.x) ? nearest : three;
    return vec3(nearest.x, -nearest.yz);
}
