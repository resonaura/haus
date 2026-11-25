// GPUIX React - React bindings for GPUI
export { createRoot, flushSync } from "./reconciler/index.js"
export { createPortal } from "./reconciler/portal.js"
export {
  createRenderer,
  enableAutomation,
  render,
  resetRender,
  startFrameLoop,
} from "./reconciler/renderer.js"
export { GpuixContext, useGpuix, useGpuixRequired } from "./hooks/use-gpuix.js"
export {
  MotionValue,
  animate,
  stagger,
  useMotionValue,
  useSpring,
  useTransform,
} from "./hooks/use-motion.js"
export type {
  SpringOptions,
  StaggerOptions,
  TransformOptions,
} from "./hooks/use-motion.js"
export { useScrollController } from "./hooks/use-scroll-controller.js"
export type { ScrollController } from "./hooks/use-scroll-controller.js"
export { useWindowInsets, useWindowSize } from "./hooks/use-window-size.js"
export { findRanges, useTextSearch } from "./hooks/use-text-search.js"
export {
  createTextSearchController,
  observeSelectedText,
  observeWindowInsets,
  observeWindowSize,
  pushDismissLayer,
  readWindowInsets,
  readWindowSize,
} from "@gpuix/native/host"
export type { DismissLayer } from "@gpuix/native/host"
export type {
  FindRangesOptions,
  TextSearch,
  TextSearchOptions,
} from "./hooks/use-text-search.js"
export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "./components/select.js"
export type {
  SelectContentProps,
  SelectItemData,
  SelectItemProps,
  SelectItemState,
  SelectProps,
  SelectTriggerProps,
  SelectTriggerState,
  SelectValueProps,
} from "./components/select.js"
export {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxSeparator,
  ComboboxTrigger,
  ComboboxValue,
} from "./components/combobox.js"
export type {
  ComboboxInputProps,
  ComboboxItemProps,
  ComboboxItemState,
  ComboboxListProps,
  ComboboxProps,
  ComboboxTriggerProps,
  ComboboxValueProps,
} from "./components/combobox.js"
export { Button, buttonProps } from "./components/button.js"
export type { ButtonBehavior, ButtonProps, ButtonState } from "./components/button.js"
export {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogDescription,
  DialogPopup,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from "./components/dialog.js"
export { DismissableLayer } from "./components/floating.js"
export type { DismissableLayerProps } from "./components/floating.js"
export type {
  DialogBackdropProps,
  DialogCloseProps,
  DialogPopupProps,
  DialogPortalProps,
  DialogProps,
  DialogTriggerProps,
} from "./components/dialog.js"
export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./components/tooltip.js"
export type {
  TooltipContentProps,
  TooltipProps,
  TooltipProviderProps,
  TooltipTriggerProps,
} from "./components/tooltip.js"
export {
  AnimatePresence,
  motion,
  useIsPresent,
  usePresence,
} from "./components/index.js"
export type { AnimatePresenceProps } from "./components/index.js"
export type { Root, FrameLoop, RenderOptions } from "./reconciler/renderer.js"
export type {
  WindowInsets,
  WindowInsetsOptions,
  WindowSize,
  WindowSizeOptions,
} from "./hooks/use-window-size.js"

// Re-export types
export type { MotionDivProps, MotionElementProps } from "./components/index.js"
export type {
  AnchoredProps,
  CodeProps,
  ConicGradientBackground,
  CursorValue,
  CustomShaderDesc,
  DebugFrameOverlayMode,
  DebugFrameOverlayStats,
  DiffProps,
  DimensionValue,
  EdgeInsets,
  ElementBounds,
  GlowDesc,
  GpuixMetrics,
  GpuixTheme,
  GradientBackground,
  HighlightMatch,
  HighlightSpec,
  ImgInstance,
  ImgProps,
  FocusTarget,
  InputProps,
  KeyEvent,
  LinearGradientBackground,
  LinearGradientStop,
  LiquidGlassDesc,
  MarkdownProps,
  MaskDesc,
  MotionBindDesc,
  MotionBindProperty,
  MotionEase,
  MotionProps,
  MotionStyle,
  MotionTargetStyle,
  MotionTargetValue,
  MotionTransition,
  MutationHost,
  NativeRenderer,
  NativeScrollState,
  NativeWindowInsets,
  OverscrollBehavior,
  PathPromptOptions,
  PerfMetrics,
  Props,
  PublicInstance,
  RadialGradientBackground,
  ScrollBindDesc,
  ScrollPolicy,
  ScrollShadowDesc,
  StyleDesc,
  SvgProps,
  SelectionHost,
  SyntaxTheme,
  TextareaProps,
  TransformDesc,
  TransformOriginDesc,
  VirtualListProps,
  WindowInsetsHost,
  WindowKeyEventHandler,
  WindowKeyEventHandlers,
  WindowSizeHost,
} from "./types/host.js"
export { handleGpuixEvent } from "./reconciler/event-registry.js"
export {
  applyMacCpuThrottleFromEnv,
  MAC_CPU_THROTTLES,
  readMacCpuThrottle,
} from "./cpu-throttle.js"
export type { MacCpuThrottle } from "./cpu-throttle.js"
export { collectGarbageWhenIdle } from "./idle-gc.js"
export type { IdleGcOptions } from "./idle-gc.js"
export type {
  EventPayload,
  EventModifiers,
  WindowOptions,
  WindowSize as NativeWindowSize,
} from "@gpuix/native"

export { GpuixRenderer, isTerminal } from "@gpuix/native"
