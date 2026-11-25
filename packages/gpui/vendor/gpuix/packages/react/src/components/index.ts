import { createElement, forwardRef, useContext, useEffect, useMemo } from "react"
import type { ReactElement, ReactNode } from "react"
import type { MotionProps, Props, PublicInstance, StyleDesc } from "../types/host.js"
import { PresenceContext, usePresence } from "./animate-presence.js"

let nextMotionGeneration = 0

function motionStyleKey(style: MotionProps["animate"] | false | undefined) {
  if (!style) return style
  return [
    style.width,
    style.height,
    style.opacity,
    style.top,
    style.right,
    style.bottom,
    style.left,
    style.borderRadius,
    style.x,
    style.y,
    style.scale,
    style.scaleX,
    style.scaleY,
    style.rotate,
    style.skewX,
    style.skewY,
    style.blur,
    style.backdropBlur,
  ]
}

export {
  AnimatePresence,
  PresenceContext,
  useIsPresent,
  usePresence,
} from "./animate-presence.js"
export type { AnimatePresenceProps } from "./animate-presence.js"

export const gpuixComponents = {
  div: "div",
  text: "text",
  img: "img",
  svg: "svg",
  canvas: "canvas",
  input: "input",
  textarea: "textarea",
  anchored: "anchored",
  "virtual-list": "virtual-list",
} as const

export type GpuixComponentType = keyof typeof gpuixComponents

export interface MotionElementProps extends MotionProps {
  children?: ReactNode
  style?: StyleDesc
  onClick?: Props["onClick"]
  onMouseDown?: Props["onMouseDown"]
  onMouseUp?: Props["onMouseUp"]
  onMouseEnter?: Props["onMouseEnter"]
  onMouseLeave?: Props["onMouseLeave"]
  onMouseMove?: Props["onMouseMove"]
  onMouseDownOutside?: Props["onMouseDownOutside"]
  onKeyDown?: Props["onKeyDown"]
  onKeyUp?: Props["onKeyUp"]
  onFocus?: Props["onFocus"]
  onBlur?: Props["onBlur"]
  onScroll?: Props["onScroll"]
  onFileDrop?: Props["onFileDrop"]
  onMotionComplete?: Props["onMotionComplete"]
  autoFocus?: boolean
  role?: string
  testId?: string
  tabIndex?: number
}

export type MotionDivProps = MotionElementProps

function createMotionComponent(elementType: "div" | "text") {
  return forwardRef<PublicInstance, MotionElementProps>(function MotionComponent(
    { initial, animate, exit, transition, onMotionComplete, ...props },
    ref
  ): ReactElement {
    const presence = useContext(PresenceContext)
    const [isPresent, safeToRemove] = usePresence()
    const resolvedInitial = presence?.initial === false ? false : initial
    const resolvedAnimate = !isPresent && exit ? exit : animate

    useEffect(() => {
      if (!isPresent && !exit) safeToRemove?.()
    }, [exit, isPresent, safeToRemove])

    const motionKey = JSON.stringify([
      isPresent,
      motionStyleKey(resolvedInitial),
      motionStyleKey(resolvedAnimate),
      transition?.type,
      transition?.duration,
      transition?.delay,
      transition?.ease,
      transition?.times,
      transition?.stiffness,
      transition?.damping,
      transition?.mass,
      transition?.velocity,
      transition?.bounce,
      transition?.repeat,
      transition?.repeatType,
      transition?.repeatDelay,
    ])
    const generation = useMemo(() => ++nextMotionGeneration, [motionKey])

    const motionDescription = {
      generation,
      isExit: !isPresent && exit !== undefined,
      initial: resolvedInitial,
      animate: resolvedAnimate,
      transition,
    }
    const hostProps: Props = {
      ...props,
      ref,
      motion: motionDescription,
    }
    if (!isPresent || onMotionComplete) {
      hostProps.onMotionComplete = (event) => {
        if (event.motionGeneration !== generation) return
        onMotionComplete?.(event)
        if (!isPresent) safeToRemove?.()
      }
    }
    return createElement(elementType, hostProps)
  })
}

/** Native GPU-animated components with a Motion-compatible declarative React API. */
export const motion = {
  div: createMotionComponent("div"),
  text: createMotionComponent("text"),
} as const
