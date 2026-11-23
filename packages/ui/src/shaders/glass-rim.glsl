// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright © 2026 Andrii Vynohradov. All rights reserved.
// Analytical supercircle SDF and dual-band specular/diffuse rim lighting.

vec3 hausGlassShape(vec2 point, vec2 halfSize, float radius) {
    float r = max(min(abs(radius), min(halfSize.x, halfSize.y)), 0.0001);
    float extent = r * 1.5286649465560913;
    vec2 blend = clamp((halfSize / r - 1.52866) / -0.52866, 0.0, 1.0);
    float normalExtent = mix(extent, r, max(blend.x, blend.y));
    vec2 corner = abs(point) - halfSize + vec2(normalExtent);
    vec2 q = max((abs(point) - halfSize + vec2(extent)) / extent, vec2(0.0));
    float major = max(q.x, q.y);
    float minor = min(q.x, q.y);
    float t = major > 0.0 ? clamp(minor / major, 0.0, 1.0) : 0.0;
    float polynomial = (((3.1560099124908447 - t * 0.9260540008544922) * t
        - 3.6412200927734375) * t + 1.268030047416687) * t + 0.2685309946537018;
    float magnitude = length(q);
    float continuous = magnitude + 1.0 - 1.0 / (1.0 - t * t * clamp(magnitude, 0.0, 1.0) * polynomial);
    float circular = length(max(q * 1.5286649465560913 - vec2(0.5286650061607361), vec2(0.0)))
        * 0.6541655659675598 + 0.3458344340324402;
    float orientation = q.y > q.x ? 1.0 : -1.0;
    float weight = clamp(0.5 - orientation + orientation * t, 0.0, 1.0);
    vec2 distances = mix(vec2(continuous), vec2(circular), blend);
    float distance = (mix(distances.x, distances.y, weight) - 1.0) * extent
        + min(max(corner.x, corner.y), 0.0);
    vec2 normal = max(corner, vec2(0.0));
    float normalLength = length(normal);
    normal = normalLength > 0.0 ? normal / normalLength
        : (corner.x > corner.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0));
    return vec3(distance, normal * sign(point));
}

float hausRimBand(float distanceInside, float height, float curvature,
                  float angular, float amount, float aaWidth) {
    float x = clamp(distanceInside / height, 0.0, 1.0);
    float falloff = mix(x < 1.0 ? 1.0 : 0.0, 1.0 - x, curvature);
    float coverage = clamp(distanceInside / aaWidth + 0.5, 0.0, 1.0)
                   * clamp((height - distanceInside) / aaWidth + 0.5, 0.0, 1.0);
    float a = falloff * coverage * angular;
    float bias = 1.0 / amount - 2.0;
    return a / max(1.0 + bias * (1.0 - a), 0.0001);
}

float hausGlassRim(float distanceInside, vec2 outwardNormal, float aaWidth) {
    float facing = abs(outwardNormal.y);
    float spread = cos(1.523526992886717);
    float diffuseSpread = cos(0.9902925090802006);
    float angular = clamp((facing - spread) / (1.0 - spread), 0.0, 1.0);
    float diffuseAngular = clamp((facing - diffuseSpread) / (1.0 - diffuseSpread), 0.0, 1.0);
    float aa = max(aaWidth, 0.0001);
    return hausRimBand(distanceInside, 1.0, 0.75, angular, 0.5, aa)
         + hausRimBand(distanceInside, 8.0, 1.0, diffuseAngular, 0.07500000298023224, aa);
}

vec3 hausGlassRimComposite(vec3 material, float intensity, float isDark) {
    vec3 darkLight = vec3(
        dot(material, vec3(1.09375, -0.357666015625, -0.0360107421875)),
        dot(material, vec3(-0.1063232421875, 0.84228515625, -0.036102294921875)),
        dot(material, vec3(-0.10638427734375, -0.357421875, 1.1640625))) + vec3(0.25);
    vec3 lightLight = vec3(
        dot(material, vec3(1.2626953125, -0.238525390625, -0.0240020751953125)),
        dot(material, vec3(-0.07080078125, 1.0947265625, -0.0240936279296875)),
        dot(material, vec3(-0.0709228515625, -0.23828125, 1.3095703125))) + vec3(0.199951171875);
    vec3 light = clamp(mix(lightLight, darkLight, isDark), -0.75, 1.0);
    return mix(material, light, intensity);
}
