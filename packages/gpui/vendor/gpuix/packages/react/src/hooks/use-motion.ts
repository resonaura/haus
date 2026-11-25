import { useEffect, useId, useMemo, useRef } from "react"
import type {
  MotionBindDesc,
  MotionBindProperty,
  MotionTransition,
  NativeRenderer,
} from "../types/host.js"
import { useGpuix } from "./use-gpuix.js"

export interface SpringOptions {
  stiffness?: number
  damping?: number
  mass?: number
  velocity?: number
  bounce?: number
  duration?: number
  restDelta?: number
  restSpeed?: number
}

export interface TransformOptions {
  clamp?: boolean
}

export interface StaggerOptions {
  startDelay?: number
  from?: "first" | "last" | "center" | number
}

/**
 * Native imperative motion value synchronized to Rust without triggering
 * React re-renders during animations or direct updates.
 */
export class MotionValue {
  readonly id: string
  private cachedValue: number
  private renderer: NativeRenderer | null
  private listeners = new Set<(value: number) => void>()

  constructor(id: string, initial: number, renderer: NativeRenderer | null) {
    this.id = id
    this.cachedValue = initial
    this.renderer = renderer
  }

  /** Attach or update the live native renderer reference (safe across mounts). */
  _attach(renderer: NativeRenderer | null): void {
    this.renderer = renderer
  }

  getRenderer(): NativeRenderer | null {
    return this.renderer
  }

  get(): number {
    const nativeVal = this.renderer?.getMotionValue?.(this.id)
    if (typeof nativeVal === "number" && Number.isFinite(nativeVal)) {
      this.cachedValue = nativeVal
    }
    return this.cachedValue
  }

  set(value: number): void {
    if (!Number.isFinite(value)) return
    this.cachedValue = value
    this.renderer?.setMotionValue?.(this.id, value)
    for (const listener of this.listeners) {
      listener(value)
    }
  }

  jump(value: number): void {
    this.set(value)
  }

  onChange(listener: (value: number) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  bind(
    property: MotionBindProperty,
    options?: {
      inputRange?: [number, number]
      outputRange?: [number, number]
      clamp?: boolean
    }
  ): MotionBindDesc {
    return {
      sourceId: this.id,
      property,
      ...(options?.inputRange ? { inputRange: options.inputRange } : {}),
      ...(options?.outputRange ? { outputRange: options.outputRange } : {}),
      ...(options?.clamp !== undefined ? { clamp: options.clamp } : {}),
    }
  }
}

export function useMotionValue(initial: number): MotionValue {
  const autoId = useId()
  const mvId = `gpuix-mv-${autoId}`
  const { renderer } = useGpuix()
  const ref = useRef<MotionValue | null>(null)
  if (!ref.current) {
    ref.current = new MotionValue(mvId, initial, renderer)
    renderer?.configureMotionValue?.(mvId, JSON.stringify({ kind: "value", initial }))
  } else {
    ref.current._attach(renderer)
  }

  useEffect(() => {
    renderer?.configureMotionValue?.(mvId, JSON.stringify({ kind: "value", initial }))
    return () => {
      renderer?.configureMotionValue?.(mvId, JSON.stringify({ kind: "remove" }))
    }
  }, [mvId, renderer])

  return ref.current
}

export function useSpring(
  source: MotionValue | number,
  config: SpringOptions = {}
): MotionValue {
  const autoId = useId()
  const mvId = `gpuix-mv-spring-${autoId}`
  const { renderer } = useGpuix()
  const initialValue = typeof source === "number" ? source : source.get()
  const configKey = JSON.stringify(config)

  const ref = useRef<MotionValue | null>(null)
  if (!ref.current) {
    ref.current = new MotionValue(mvId, initialValue, renderer)
    if (typeof source === "number") {
      renderer?.configureMotionValue?.(
        mvId,
        JSON.stringify({ kind: "value", initial: initialValue })
      )
    } else {
      renderer?.configureMotionValue?.(
        mvId,
        JSON.stringify({
          kind: "spring",
          sourceId: source.id,
          initial: initialValue,
          ...config,
        })
      )
    }
  } else {
    ref.current._attach(renderer)
  }

  useEffect(() => {
    if (typeof source === "number") {
      renderer?.animateMotionValue?.(
        mvId,
        JSON.stringify({
          to: source,
          transition: { type: "spring", ...config },
        })
      )
    } else {
      renderer?.configureMotionValue?.(
        mvId,
        JSON.stringify({
          kind: "spring",
          sourceId: source.id,
          ...config,
        })
      )
    }
  }, [mvId, renderer, typeof source === "number" ? source : source.id, configKey])

  useEffect(() => {
    return () => {
      renderer?.configureMotionValue?.(mvId, JSON.stringify({ kind: "remove" }))
    }
  }, [mvId, renderer])

  return ref.current
}

export function useTransform(
  source: MotionValue,
  inputRange: number[],
  outputRange: number[],
  options: TransformOptions = {}
): MotionValue {
  const autoId = useId()
  const mvId = `gpuix-mv-xform-${autoId}`
  const { renderer } = useGpuix()
  const rangeKey = JSON.stringify([source.id, inputRange, outputRange, options.clamp ?? true])

  const mv = useMemo(() => {
    const out = new MotionValue(mvId, outputRange[0] ?? 0, renderer)
    renderer?.configureMotionValue?.(
      mvId,
      JSON.stringify({
        kind: "transform",
        sourceId: source.id,
        inputRange,
        outputRange,
        clamp: options.clamp ?? true,
      })
    )
    return out
  }, [mvId, renderer, rangeKey])

  useEffect(() => {
    renderer?.configureMotionValue?.(
      mvId,
      JSON.stringify({
        kind: "transform",
        sourceId: source.id,
        inputRange,
        outputRange,
        clamp: options.clamp ?? true,
      })
    )
    return () => {
      renderer?.configureMotionValue?.(mvId, JSON.stringify({ kind: "remove" }))
    }
  }, [mvId, renderer, rangeKey])

  return mv
}

/**
 * Imperatively animate a `MotionValue` on the native GPUI render thread with
 * springs, tweens, keyframes, and repeat loops without triggering React commits.
 */
export function animate(
  target: MotionValue,
  to: number | Array<number | null>,
  transition: MotionTransition = {}
): { stop: () => void } {
  const renderer = target.getRenderer()
  renderer?.animateMotionValue?.(target.id, JSON.stringify({ to, transition }))
  return {
    stop() {
      const current = target.get()
      renderer?.setMotionValue?.(target.id, current)
    },
  }
}

/**
 * Compute per-index transition delays for staggered list and card entrances.
 */
export function stagger(
  stepSeconds: number,
  options: StaggerOptions = {}
): (index: number, total: number) => number {
  const startDelay = options.startDelay ?? 0
  const from = options.from ?? "first"
  return (index: number, total: number) => {
    const clampedTotal = Math.max(1, total)
    const origin =
      from === "first"
        ? 0
        : from === "last"
          ? clampedTotal - 1
          : from === "center"
            ? (clampedTotal - 1) / 2
            : Math.max(0, Math.min(clampedTotal - 1, from))
    return startDelay + Math.abs(index - origin) * stepSeconds
  }
}
