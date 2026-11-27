<!-- SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. -->

# GPUI Compositor, Analytical Liquid Glass, Native Motion, and Incremental Rendering

Architecture reference for `@haus/gpui` (`packages/gpui`), GPUIX native compositor extensions, analytical Liquid Glass WGSL shading, incremental GPU rendering (`P29a`–`P29d`), `@haus/ui/gpui` style lowering, and verification boundaries.

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

## Incremental GPU Rendering, Subtree Replay, and Backdrop Blur Caching

The incremental pipeline eliminates full-window CPU layout/paint rebuilds and redundant GPU Kawase/Gaussian blur passes when foreground layers (modals, popovers, inputs, hover highlights) update over clean background trees:

- **Differential Fallback (`GPUI_INCREMENTAL`)**: `gpui::incremental_rendering_enabled()` / `set_incremental_rendering_enabled(Option<bool>)` (`gpui/src/gpui.rs`, exposed via `renderer.setIncrementalRendering(...)`) switches atomically between incremental caches and a full-render reference path (`TaffyLayoutEngine`, `ViewElement::cached`, `SubtreeCache`, portal hoisting, and `BackdropBlurCache`).
- **Fine-Grained Dirty Propagation & Refresh Discipline**: `DirtyFlags` (`HIT_TEST | COMPOSITE | PAINT | BACKDROP | LAYOUT | STRUCTURE`, `src/cache/dirty.rs`) classifies mutations in `RetainedTree` (`portal_free_revision` isolates ancestor revisions from mutations inside `<anchored>` portals; `layout_revision` isolates paint-only updates). Empty/no-op batches skip GPUI draws (`noop_batch_count`), post-frame-0 `window.refresh()` calls are replaced with targeted `cx.notify()`, and `Div` `clear_cross` scroll arbitration (`elements/div.rs`) consumes only the dominant wheel axis on single-axis scrollers so perpendicular wheel gestures bubble cleanly.
- **Portal Hoisting & `O(1)` Subtree Replay (`src/cache/{subtree,element}.rs`, `taffy.rs`, `window.rs`)**:
  - Top-level hoisting of `<anchored>` portals (`collect_hoisted_portals` + `wrap_portal_typography` in `renderer.rs`) renders modals/popovers as sibling layers above `BACKGROUND_LAYER_CACHE_ID`.
  - `CachedSubtreeElement` records `Window` `prepaint`/`paint` ranges (`Window::replay_prepaint` / `Window::replay_paint`), double-buffered `BOUNDS` (`automation.rs`) and `TextPaint` (`text/paint.rs`) slices, and unrounded Taffy `(raw_origin_bits, raw_device_size)` (`Window::raw_layout_geometry` / `Window::request_replayed_layout`) so replayed subtrees preserve bit-exact IEEE-754 subpixel edge accumulation.
  - `SubtreeCacheKey` hashes `(portal_free_revision, scroll_hash, inherited_hash, focus_hash, portals_hash, motion_epoch, pointer_hash)`. Idle FLIP springs (`are_motion_bindings_active`) remain cacheable until `motion_values_epoch()` advances, and `compute_bg_pointer_state` scopes `:hover`/`:active` invalidations to the hovered branch (`0` background invalidations while occluded by a modal). During active scroll settling, interior subtree recording inside scrollports is bypassed so scroll frames incur zero cache-recording or `LayoutKeys` overhead.
- **Scene Underneath Digest & GPU `BackdropBlurCache` (`scene.rs`, `gpui_apple`, `gpui_wgpu`)**:
  - `Scene::backdrop_underneath_digest_for_backdrops` and `_for_shaders` hash all lower `(order, PrimitiveKind)` primitives intersecting `effective_clip` (expanded across earlier transformed/blurred `LayerEffect`s, incorporating `PlatformAtlas` `tile_generations` and returning `None` over live hardware `PaintSurface` video textures).
  - `MetalRenderer` (`gpui_apple/src/metal_renderer.rs`) and `WgpuRenderer` (`gpui_wgpu/src/wgpu_renderer.rs`) maintain a 32-slot LRU `BackdropBlurCache` with `MAX_FRAMES_IN_FLIGHT` frame-sequence hazard protection and `IDLE_RELEASE` eviction. When all backdrop batches in a frame hit cache (`all_backdrops_cached`), the renderer sets `mirrored = false`, drawing directly into the swapchain drawable without `FilterTarget::Frame` offscreen mirroring, mid-frame encoder breaks, or end-of-frame blits.

## `@haus/ui/gpui` Integration

`packages/ui/src/gpui/style.ts` (`styleFor`) lowers `@haus/ui` `UiStyleSpec` trees directly to native GPUIX `StyleDesc` props (preserving hover/pressed/focus state overlays in `packages/ui/src/gpui/host.tsx`):

- Lowers `TransformSpec` (`translateX/Y`, `scale`, `scaleX/Y`, `rotateDeg`, `skewXDeg/Y`, `matrix`, `originX/Y`) and `corners` (`superellipse` smoothing).
- Converts all `shadows` (including `inset`), `MaterialIR` `blur` / `backdrop` / multi-stop `linear` / `radial` gradients (clearing flat `backgroundColor` when shader gradients apply), `LiquidGlassMaterial` (`id === 'haus.liquid-glass.v1'`) into `LiquidGlassDesc`, and custom WGSL `ShaderMaterial` passes into `CustomShaderDesc`.
- `ProgressiveBlur` (`packages/ui/src/shaders/progressive-blur.wgsl`) describes an edge backdrop blur ramp shared by camera and dock surfaces, honoring reduced transparency.

## Verification & Observed Benchmarks (`darwin` `arm64`, Metal `runtime_shaders`)

Measured on Apple M1 Metal (`NODE_ENV=production`) after `pnpm --filter @haus/gpui fork:build`:

| Benchmark / Check                           | Samples | p50 (ms) | Draw (ms) | Key Telemetry                                                         |
| ------------------------------------------- | ------- | -------- | --------- | --------------------------------------------------------------------- |
| `compositor_liquid_glass_panel`             | 20      | 0.340    | 0.118     | `replayedElements`: 50, `taffyWrites`: 0, `backdropPasses`: 0         |
| `native_motion_spring_transforms_0_commits` | 30      | 0.300    | 0.336     | `commits`: 0, `taffyWrites`: 0, `rssMb`: 235.38                       |
| `synthetic_hover_120_cards_native`          | 24      | 0.844    | 0.098     | `commits`: 0, `replayedSubtrees`: 1, `taffyWrites`: 0                 |
| `preview_home_vertical_scroll`              | 40      | 27.336   | 4.637     | `commits`: 0, `taffyWrites`: 0, `rssMb`: 179.56                       |
| `scroll_long_list_1000`                     | 30      | 12.112   | 1.744     | `builtElements`: 91 / 2001, `taffyWrites`: 0                          |
| `incremental-rendering` (Modal over Home)   | diff    | —        | 0.920     | vs `26.53 ms` full (`28.8x`), `replayedElements`: 912, `pixelDiff`: 0 |

Verified on this host:

- `gpui` (`backdrop_underneath_digest`), `gpui_apple` (`runtime_shaders`), `gpui_wgpu`, and `gpuix-native` (`312/312`) Rust test suites.
- `apps/desktop/scripts/gpui/checks/incremental-rendering.ts` (`5/5`: no-op batch suppression, modal caret/search/hover over `HomeWorkspace` with `0` GPU backdrop passes, background mutation + animated aurora selective invalidation, non-modal hover, diagonal scroll arbitration, and `0 / 3,891,200` Retina pixel diff across all screenshot pairs).
- `check-compositor.ts`, `check-scroll.ts` (`8/8`), `modal-backdrop-occlusion.ts` (`4/4`), `topbar-and-sticky-dock.ts`, `@gpuix/react` Vitest (`63/63`), and `check:gpui:packed`.

Not verified on this macOS `arm64` host:

- Native Windows DX11 FXC shader compilation and runtime presentation.
- Linux hardware Vulkan/GL WGPU presentation, Intel macOS (`x86_64`), ProMotion 120 Hz display pacing, and `gpui_web` WASM presentation.
