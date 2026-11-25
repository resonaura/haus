<!-- SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. -->

# GPUI Compositor, Analytical Liquid Glass, and Native Motion

Architecture reference for `@haus/gpui` (`packages/gpui`), GPUIX native compositor extensions, analytical Liquid Glass WGSL shading, `@haus/ui/gpui` style lowering, and verification boundaries.

## Minimized Standalone Runtime and Direct Vendoring

Haus vendors both the minimized GPUI runtime and GPUIX directly inside `@haus/gpui` with no nested `.git` subrepositories (`packages/gpui/manifest.json` `"vendoredDirectly": true`):

- `packages/gpui/vendor/gpui`: standalone 25-crate workspace extracted from Zed's `gpui` branch via `packages/gpui/scripts/prune-workspace.ts` (`pnpm --filter @haus/gpui fork:prune`), excluding Zed editor, AI, and LSP crates while retaining `gpui`, `gpui_apple`, `gpui_wgpu`, `gpui_macos`, `gpui_linux`, `gpui_windows`, `gpui_web`, `gpui_platform`, `gpui_macros`, `gpui_util`, `gpui_shared_string`, `collections`, `media`, `scheduler`, `sum_tree`, `http_client`, `http_client_tls`, `reqwest_client`, `refineable`, `derive_refineable`, `util_macros`, `zlog`, `ztracing`, `ztracing_macro`, and `perf`.
- `packages/gpui/vendor/gpuix`: GPUIX Rust N-API/WASM native core (`@gpuix/native`) and React reconciler (`@gpuix/react`).
- Upstream tracking and local release builds are scripted through `packages/gpui/scripts/fork.ts`:
  - `pnpm --filter @haus/gpui upstream:check`
  - `pnpm --filter @haus/gpui upstream:diff`
  - `pnpm --filter @haus/gpui fork:build` (compiles the release `.node` addons and TypeScript bindings)

## Core GPUI Background-Shader Compositor Hook

Standard GPUI custom shaders in `crates/gpui/src/shader.rs` prepend `SHADER_PRELUDE` (and `SHADER_BACKDROP_DECLS` when `.samples_backdrop(true)` is enabled), exposing `ShaderInput`, `fbm`, `dither`, `mix_oklab`, and `sample_backdrop(uv)` / `sample_backdrop_screen(device_pos)`. Fragment entrypoints return **straight alpha** sRGB `vec4<f32>`; `gpui_shader_fragment` multiplies `instance.opacity` and premultiplies before blending.

- `gpui::Style::paint_with_background(...)` and `Style::paint_sharp_with_background(...)` (`packages/gpui/vendor/gpui/crates/gpui/src/style.rs`) invoke an optional `paint_background(bounds, corner_radii, smoothing, window, cx)` callback immediately after solid/gradient/backdrop-blur fills and before `paint_inset_shadows`, preserving `visuals_visible` culling.
- `Interactivity::paint_background_shader(shader, instance)` (`packages/gpui/vendor/gpui/crates/gpui/src/elements/div.rs`) stores ordered `background_shaders` pairs and forwards them through `Style::paint_with_background` so containers can composite optical shaders across Metal (`gpui_apple` `to_msl`), WebGPU/WGPU (`gpui_wgpu`), and DirectX (`to_hlsl`) via `naga`.

## Native GPUIX Compositor Features (`compositor.rs` & `style.rs`)

`packages/gpui/vendor/gpuix/packages/native/src/compositor.rs` compiles and caches GPU shaders and maps `StyleDesc` fields in `apply_compositor_styles`, `apply_background_shaders`, and `scroll_shadow.rs`:

- **2D Affine Transforms & Inverse Hit-Testing**: `TransformDesc` (`translateX`, `translateY`, `scale`, `scaleX`, `scaleY`, `rotate`, `skewX`, `skewY`, or 6-element CSS `matrix: [a, b, c, d, tx, ty]`) + `TransformOriginDesc` decompose via 2D QR decomposition matching `gpui::Filter::forward_matrix()`, applying `layer_scale_xy`, `layer_rotate`, `layer_skew`, `layer_translate`, and `layer_scale_origin`. GPUI hit-testing projects pointer coordinates through the inverse layer transform.
- **Squircles & Shadows/Glow**: `cornerSmoothing` (0.0–1.0) lowers to GPUI continuous corners. `collect_box_shadows` lowers multi-entry `boxShadow` arrays plus two concentric `GlowDesc` halo shadows (`blur_radius` clamped to `200`, `intensity` clamped to `2.0`).
- **Masks & Edge Fades**: `MaskDesc` (`fadeTop`, `fadeBottom`, `fadeLeft`, `fadeRight`) maps to `fade_edges` and `fade_sides`; `scroll_shadow.rs` uses native fade masks when `mode: "fade"`.
- **Multi-Stop, Radial & Conic Gradients**: Two-stop linear gradients stay on GPUI's native `linear_gradient` quad fast path; multi-stop (> 2 stops), `radial-gradient`, and `conic-gradient` (with optional `colorSpace: 'oklab'`) use `src/shaders/gradient.wgsl` in the GPUIX native package.
- **Custom WGSL Shaders**: `CustomShaderDesc` validates and caches user WGSL (`CUSTOM_SHADER_CACHE`) with optional `samplesBackdrop`, `backdropBlurRadius`, `params` (up to 16 `f32` values), and `colors` (up to 4 RGBA entries).

## Analytical Liquid Glass Shader (`haus.liquid-glass.v1`)

`src/shaders/liquid-glass.wgsl` in the GPUIX native package implements Haus's continuous superellipse optical Liquid Glass pass with `.samples_backdrop(true).custom_shape_alpha(true)` and pre-blur via `ShaderInstance::backdrop_blur(...)`:

- **Shape & Normal Field**: `haus_glass_shape` evaluates a continuous superellipse SDF (`dist`, outward `vec2` edge normal) blended cleanly to circular arcs for small radii and anti-aliased over `1.0 / scale_factor`.
- **Snell Convex Bevel Refraction & Dispersion**: Within perimeter `bevelWidth` (`params[0].y`, default `13.28`), Snell's law (`ior` at `params[0].z`, default `1.5`, scaled by `refractionStrength` at `params[0].w`) computes radial refraction offsets and separate R/G/B `sample_backdrop` lookups stepped by `dispersion` (`params[1].x`).
- **Color & Analytical Rim Lighting**: Applies Rec. 709 `saturation` (`params[1].y`), mixes `tintColor` (`colors[0]`) at `tintOpacity` (`params[2].z`), adds y-down top-left key/fill edge highlights (`specularDial`, `edgeHighlight`, `darkenedEdge`), optionally evaluates dual-band `haus_glass_rim` + `haus_glass_rim_composite` (`nativeRim`, `isDark`), and applies `interleaved_noise` 8-bit dither.

### ShaderInstance Uniform Packing (`build_liquid_glass_instance`)

| Slot            | Field                                                 | Notes                         |
| --------------- | ----------------------------------------------------- | ----------------------------- |
| `colors[0]`     | `tintColor`                                           | Dark/light default if omitted |
| `params[0..3]`  | `cornerRadius, bevelWidth, ior, refractionStrength`   | Clamped ranges in Rust        |
| `params[4..7]`  | `dispersion, saturation, specularDial, edgeHighlight` | Spectral + highlight weights  |
| `params[8..11]` | `darkenedEdge, nativeRim, tintOpacity, isDark`        | Rim flags and tint blend      |

## Native Motion Engine & Imperative MotionValues

`packages/gpui/vendor/gpuix/packages/native/src/motion.rs` and `motion_values.rs` execute declarative `motion.*` transitions and imperative `MotionValue` tracks inside GPUI's native frame loop with **0 React commits per frame**:

- **18 Animatable Scalar Properties**: `width`, `height`, `opacity`, `top`, `right`, `bottom`, `left`, `borderRadius`, `blur`, `backdropBlur`, `x`/`translateX`, `y`/`translateY`, `scale`, `scaleX`, `scaleY`, `rotate`, `skewX`, `skewY`.
- **Analytical Physics & Easings**: `solve_spring` evaluates closed-form underdamped, critically damped, and overdamped damped harmonic oscillators (supporting both `stiffness`/`damping`/`mass` and `bounce`/`duration`) and preserves velocity on mid-flight retargeting; `MotionTargetValue` supports keyframe arrays with `times`, `repeat`/`repeatType`/`repeatDelay`, plus `linear`, `ease*`, `circ*`, and `back*` cubic-bezier curves.
- **Imperative Graph (`MOTION_VALUES`)**: `useMotionValue`, `useSpring` (re-anchoring `SpringFollow`), `useTransform` (piecewise clamped/unclamped interpolation with cycle detection), `animate`, and `stagger` exported from `@gpuix/react` / `@haus/gpui` bind directly via `style.motionBind` and advance on `tick_motion_values(now)`.

## `@haus/ui/gpui` Integration

`packages/ui/src/gpui/style.ts` (`styleFor`) lowers `@haus/ui` `UiStyleSpec` trees directly to native GPUIX `StyleDesc` props (preserving hover/pressed/focus state overlays in `packages/ui/src/gpui/host.tsx`):

- Lowers `TransformSpec` (`translateX/Y`, `scale`, `scaleX/Y`, `rotateDeg`, `skewXDeg/Y`, `matrix`, `originX/Y`) and `corners` (`superellipse` smoothing).
- Converts all `shadows` (including `inset`), `MaterialIR` `blur` / `backdrop` / multi-stop `linear` / `radial` gradients (clearing flat `backgroundColor` when shader gradients apply), `LiquidGlassMaterial` (`id === 'haus.liquid-glass.v1'`) into `LiquidGlassDesc`, and custom WGSL `ShaderMaterial` passes into `CustomShaderDesc`.

`ProgressiveBlur` describes a top-to-bottom backdrop blur ramp shared by camera surfaces. React DOM composes masked backdrop filters. GPUIX uses the compositor's prefiltered backdrop and a smooth opacity ramp. The primitive honors reduced transparency. Its authored shader is `packages/ui/src/shaders/progressive-blur.wgsl`. Keep shader source, including shared backdrop declarations and GPU test fixtures, in dedicated shader files. Use `include_str!` for Rust and run `pnpm ui:compile` to regenerate the TypeScript asset bundle.

## Verification & Observed Benchmarks (`darwin` `arm64`, Metal `runtime_shaders`)

Measured on macOS `arm64` via `bun --conditions=development apps/desktop/scripts/gpui/bench.ts apps/desktop/artifacts/gpui-bench-slice-b.json` after releasing `@haus/gpui` (`fork:build`):

| Benchmark                                   | Samples | p50 (ms) | p95 (ms) | Avg (ms) | Extra                                       |
| ------------------------------------------- | ------- | -------- | -------- | -------- | ------------------------------------------- |
| `compositor_liquid_glass_panel`             | 20      | 0.466    | 0.589    | 0.499    | `rssMb`: 228.80, `commits`: n/a (0 batches) |
| `native_motion_spring_transforms_0_commits` | 30      | 0.258    | 0.274    | 0.261    | `commits`: 0, `rssMb`: 229.89               |
| `preview_home_vertical_scroll`              | 40      | 10.286   | 12.019   | 10.369   | `drawMs`: 2.90, `retainedElements`: 639     |
| `synthetic_hover_120_cards_native`          | 24      | 5.254    | 5.740    | 5.385    | `commits`: 0, `drawMs`: 1.26                |

Verified on this host:

- `gpui` (`shader` tests, 5/5), `gpui_apple` (Metal GPU tests, 7/7), `gpui_wgpu` (35/35), and `gpuix-native` (293/293) with `--features gpui_platform/runtime_shaders` (`metal` CLI absent on host, so Metal shaders compile at runtime via `naga`).
- `apps/desktop/scripts/gpui/check-compositor.ts`: offscreen Metal Liquid Glass refraction/rim luminance pixel assertions via `sharp`, 2D transformed inverse click hit-testing, 0-commit spring/keyframe/`MotionValue` progression, and multi-stop/radial/conic/mask/glow rendering.
- `apps/desktop/scripts/gpui/check-scroll.ts` (8/8), `check:gpui`, and `check:gpui:sidebar`.

Not verified on this macOS `arm64` host:

- Native Windows DX11 FXC shader compilation and runtime presentation (`to_hlsl` IR generation is covered by `gpui` `shader::tests`, but FXC bytecode compilation and DX11 rendering require Windows).
- `gpui_web` WASM shader runtime compilation and canvas presentation.
