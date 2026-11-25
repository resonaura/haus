import { useCallback, useId, useMemo } from "react"
import type { NativeScrollState, ScrollBindDesc } from "../types/host.js"
import { useGpuix } from "./use-gpuix.js"

export interface ScrollController {
  readonly scrollId: string
  getState(): NativeScrollState | null
  scrollTo(x: number, y: number): boolean
  bind(
    metric: ScrollBindDesc["metric"],
    property: ScrollBindDesc["property"],
    inputRange: [number, number],
    outputRange: [number, number],
    clamp?: boolean
  ): ScrollBindDesc
}

/**
 * Imperative handle and native binding descriptor for a scroll container
 * carrying `style.scrollId = controller.scrollId`. Reading state or driving
 * `scrollBind` siblings triggers zero React re-renders during scroll.
 */
export function useScrollController(customId?: string): ScrollController {
  const autoId = useId()
  const scrollId = customId ?? `gpuix-scroll-${autoId}`
  const { renderer } = useGpuix()

  const getState = useCallback((): NativeScrollState | null => {
    return renderer?.getScrollState?.(scrollId) ?? null
  }, [renderer, scrollId])

  const scrollTo = useCallback(
    (x: number, y: number): boolean => {
      return renderer?.scrollToId?.(scrollId, x, y) ?? false
    },
    [renderer, scrollId]
  )

  const bind = useCallback(
    (
      metric: ScrollBindDesc["metric"],
      property: ScrollBindDesc["property"],
      inputRange: [number, number],
      outputRange: [number, number],
      clamp = true
    ): ScrollBindDesc => ({
      sourceId: scrollId,
      metric,
      property,
      inputRange,
      outputRange,
      clamp,
    }),
    [scrollId]
  )

  return useMemo(
    () => ({ scrollId, getState, scrollTo, bind }),
    [scrollId, getState, scrollTo, bind]
  )
}
