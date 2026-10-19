# Haus architecture

Haus uses Electron's main/preload/renderer separation and a feature-based React renderer. UI changes should not change the Home Assistant wire model or bypass the optimistic action queue.

## Where code belongs

```text
src/
  main/                  OAuth, transport, recordings bridge, platform materials, secure storage
  preload/               Narrow context-isolated native API
  shared/native.ts       Main/preload/renderer contracts
  renderer/src/
    app/                 Composition, navigation, deferred feature entry points, shell
    features/
      home/              Overview composition and memoized view selectors
      devices/           Tiles, grids, device sheet, actions and device controls
      cameras/           Snapshot cards, live/recorded player, canvas history
      scenes/            Scene collection, presentation and preview
      rooms/             Room-specific presentation preferences
      connections/       Pairing, inventory, integrations and add-ons
      search/            Spotlight overlay
      settings/          Preferences and server connection settings
      automations/       Automation list and server handoff
      notifications/     Alerts, updates and repair notices
      statistics/        Recorded sensor history
    components/
      ui/                Shared UI primitives with no application-feature imports
      forms/             Reusable schema and JSON fields
      icons/             Device, state and room icon rendering
      brand/             Integration and device artwork
    hooks/               Shared browser/native lifecycle and session hooks
    model/               Pure HA types, normalization, selectors and action/state rules
    ha/                  Home Assistant request adapters and dashboard sync
    styles/              Explicitly ordered global SCSS; no CSS modules
```

## Dependency direction

- `app` composes features and owns navigation and which panels are open.
- Features own their interactions and local state. Shared widgets accept data and callbacks.
- Shared components may use model and request-adapter types, but cannot import `app` or features.
- The model has no React, DOM, native or request dependencies. Presentation helpers may import immutable SVG artwork.
- The renderer accesses native capabilities through `window.hausNative`. Credentials stay in main.
- Native code may share pure model code; it must not depend on renderer UI.

`pnpm architecture:check` enforces these boundaries and the SCSS convention. It also runs as part of `pnpm check` and therefore in GitHub Actions.

## State and updates

Keep Home Assistant state, presentation preferences and temporary UI state distinct. `useHaus` remains the session/transport boundary and owns the existing optimistic queue, light memory and reconciliation. Feature actions call that queue, including grouped-light commands; they do not send a second independent stream of service calls.

`buildHomeView` derives visibility, room membership, camera ownership and scene placement from a snapshot. `useHomeView` memoizes that work. Entity ownership is indexed once, preserving first-owner behavior. Do not store another copy of derived room or camera lists in state.

Drag state lives in `AccessoryGrid`, so hovering tiles during a drag does not update the whole app. Reordering still writes the existing scoped `deviceOrder` preference. Spotlight's query belongs to its overlay and does not filter or unmount the page behind it.

## Component boundaries

Extract around responsibility: a room selector, an add-on detail panel, a light colour controller. Avoid splitting only to meet an arbitrary line count, introducing wrappers with no behavior, or giving shared primitives access to the entire application controller. A large file that combines transport, state derivation and unrelated visual surfaces needs separate boundaries.

Heavy screens and sheets use module-level `React.lazy` declarations. Camera cards import snapshot presentation, while the HLS/WebRTC player and recording history load only when opening the camera. Never declare lazy components inside a render function because that can reset their state.

## Styles

`styles/vendor.css` contains only the Tailwind and HeroUI imports. Tailwind v4 is processed by its Vite plugin, outside Sass. All authored Haus rules use global SCSS and the modern `@use` system. The optional Parcel watcher build script is explicitly disabled: Vite owns file watching and the build uses the embedded Sass compiler.

`styles/index.scss` is the single authored-style entry. It imports feature control/player styles, foundation rules, ordered visual refinements, platform materials and accessibility treatments. Keeping the order explicit makes deferred JavaScript imports independent of the cascade.

`theme/` and `design/` partials retain the prior rule order, including responsive and refinement layers. They are deliberately not independent theme modules. During migration the compressed Sass output, excluding intentional accessibility additions, matched the previous rules exactly. Consolidating old overrides should be a separate visual change with screenshot checks, rather than part of file moves.

Prefer theme custom properties for runtime colours and materials. SCSS mixins may share compile-time patterns such as focus rings. Keep nesting shallow; do not increase selector specificity as a workaround for the cascade.

## Validation

Run `pnpm check` and `pnpm build`. Review web and native surfaces because browser screenshots cannot verify native Liquid Glass, vibrancy or Windows acrylic. Exercise device actions against the demo first. Hardware testing for this home is restricted to Narnia; leave its lights off and do not alter existing scenes.

For performance, compare production entry/chunk sizes, check request frequency, and profile a large home. Code splitting reduces startup work but does not make the total application smaller by itself. Snapshot cards stop polling outside the viewport; the last frame and its age remain visible when scrolling back.

## References

- [React: Thinking in React](https://react.dev/learn/thinking-in-react) — component responsibilities, data flow and minimal state.
- [React: lazy](https://react.dev/reference/react/lazy) — defer component code until first use.
- [Vite: CSS preprocessors](https://vite.dev/guide/features.html#css-pre-processors) — supported SCSS pipeline.
- [Sass: @use](https://sass-lang.com/documentation/at-rules/use/) — explicit module loading.
- [Tailwind: compatibility](https://tailwindcss.com/docs/compatibility#sass-less-and-stylus) — keep Tailwind v4 outside Sass.
- [Electron: performance](https://www.electronjs.org/docs/latest/tutorial/performance) — defer work and measure before optimizing.
