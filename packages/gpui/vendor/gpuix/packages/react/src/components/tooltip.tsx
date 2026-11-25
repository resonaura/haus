/** Headless shadcn-shaped Tooltip components over GPUIX anchored layers. */

import React, {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react"
import type { ReactElement, ReactNode } from "react"
import type { Props, PublicInstance } from "../types/host.js"
import {
  FloatingLayer,
  floatingRootStyle,
  renderSlot,
  useControllableState,
  DismissableLayer,
} from "./floating.js"
import type { FloatingContentProps } from "./floating.js"

interface TooltipProviderContextValue {
  delayDuration: number
  skipDelayDuration: number
  disableHoverableContent: boolean
  lastClosedAt: React.MutableRefObject<number>
}

const defaultProvider: TooltipProviderContextValue = {
  delayDuration: 0,
  skipDelayDuration: 300,
  disableHoverableContent: false,
  lastClosedAt: { current: Number.NEGATIVE_INFINITY },
}

const TooltipProviderContext = createContext(defaultProvider)

export interface TooltipProviderProps {
  children: ReactNode
  delayDuration?: number
  skipDelayDuration?: number
  disableHoverableContent?: boolean
}

export function TooltipProvider({
  children,
  delayDuration = 0,
  skipDelayDuration = 300,
  disableHoverableContent = false,
}: TooltipProviderProps): ReactElement {
  const lastClosedAt = useRef(Number.NEGATIVE_INFINITY)
  const value = useMemo(
    () => ({ delayDuration, skipDelayDuration, disableHoverableContent, lastClosedAt }),
    [delayDuration, skipDelayDuration, disableHoverableContent]
  )
  return <TooltipProviderContext.Provider value={value}>{children}</TooltipProviderContext.Provider>
}

interface TooltipContextValue {
  open: boolean
  disableHoverableContent: boolean
  openImmediately: () => void
  scheduleOpen: () => void
  scheduleClose: () => void
  cancelClose: () => void
  close: () => void
}

const TooltipContext = createContext<TooltipContextValue | null>(null)

function useTooltipContext(name: string): TooltipContextValue {
  const context = useContext(TooltipContext)
  if (!context) throw new Error(`${name} must be used inside Tooltip`)
  return context
}

export interface TooltipProps extends Omit<Props, "children"> {
  children?: ReactNode
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  delayDuration?: number
  disableHoverableContent?: boolean
}

export function Tooltip({
  children,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  delayDuration,
  disableHoverableContent,
  style,
  ...props
}: TooltipProps): ReactElement {
  const provider = useContext(TooltipProviderContext)
  const [open, setOpenState] = useControllableState({
    value: openProp,
    defaultValue: defaultOpen,
    onChange: onOpenChange,
  })
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hoverableDisabled = disableHoverableContent ?? provider.disableHoverableContent

  const cancelOpen = () => {
    if (openTimer.current !== null) clearTimeout(openTimer.current)
    openTimer.current = null
  }
  const cancelClose = () => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current)
    closeTimer.current = null
  }
  const setOpen = (nextOpen: boolean) => {
    cancelOpen()
    cancelClose()
    setOpenState(nextOpen)
    if (!nextOpen) provider.lastClosedAt.current = Date.now()
  }
  const openImmediately = () => setOpen(true)
  const scheduleOpen = () => {
    cancelClose()
    const recentlyClosed = Date.now() - provider.lastClosedAt.current <= provider.skipDelayDuration
    const delay = recentlyClosed ? 0 : (delayDuration ?? provider.delayDuration)
    if (delay <= 0) {
      setOpen(true)
      return
    }
    cancelOpen()
    openTimer.current = setTimeout(() => setOpen(true), delay)
  }
  const close = () => setOpen(false)
  const scheduleClose = () => {
    cancelOpen()
    if (hoverableDisabled) {
      close()
      return
    }
    cancelClose()
    closeTimer.current = setTimeout(close, 80)
  }

  useEffect(() => () => {
    cancelOpen()
    cancelClose()
  }, [])

  const context: TooltipContextValue = {
    open,
    disableHoverableContent: hoverableDisabled,
    openImmediately,
    scheduleOpen,
    scheduleClose,
    cancelClose,
    close,
  }

  return (
    <TooltipContext.Provider value={context}>
      <div {...props} style={floatingRootStyle(style)}>{children}</div>
    </TooltipContext.Provider>
  )
}

export interface TooltipTriggerProps extends Props {
  asChild?: boolean
}

export const TooltipTrigger = forwardRef<PublicInstance, TooltipTriggerProps>(
  function TooltipTrigger(
    {
      asChild,
      children,
      onMouseEnter,
      onMouseLeave,
      onMouseDown,
      onClick,
      onFocus,
      onBlur,
      ...props
    },
    ref
  ) {
    const context = useTooltipContext("TooltipTrigger")
    return renderSlot({
      asChild,
      children,
      props: {
        ...props,
        onMouseEnter: (event) => {
          onMouseEnter?.(event)
          context.scheduleOpen()
        },
        onMouseLeave: (event) => {
          onMouseLeave?.(event)
          context.scheduleClose()
        },
        onMouseDown: (event) => {
          onMouseDown?.(event)
          context.close()
        },
        onClick: (event) => {
          onClick?.(event)
          context.close()
        },
        onFocus: (event) => {
          onFocus?.(event)
          context.openImmediately()
        },
        onBlur: (event) => {
          onBlur?.(event)
          context.close()
        },
      },
      ref,
      defaultTabIndex: 0,
    })
  }
)

export interface TooltipContentProps extends FloatingContentProps {}

export const TooltipContent = forwardRef<PublicInstance, TooltipContentProps>(
  function TooltipContent(
    { children, side = "top", align = "center", sideOffset = 0, onMouseEnter, onMouseLeave, ...props },
    ref
  ) {
    const context = useTooltipContext("TooltipContent")
    if (!context.open) return null
    return (
      <DismissableLayer onEscapeKeyDown={context.close}>
        <FloatingLayer
          {...props}
          ref={ref}
          side={side}
          align={align}
          sideOffset={sideOffset}
          onMouseEnter={(event) => {
            onMouseEnter?.(event)
            if (!context.disableHoverableContent) context.cancelClose()
          }}
          onMouseLeave={(event) => {
            onMouseLeave?.(event)
            context.scheduleClose()
          }}
        >
          {children}
        </FloatingLayer>
      </DismissableLayer>
    )
  }
)

export {
  Tooltip as Root,
  TooltipContent as Content,
  TooltipProvider as Provider,
  TooltipTrigger as Trigger,
}
