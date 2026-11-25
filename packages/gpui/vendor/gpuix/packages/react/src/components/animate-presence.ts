import {
  Children,
  createContext,
  createElement,
  Fragment,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import type { ReactElement, ReactNode } from "react"
export type ComponentKey = string | number

export interface PresenceContextValue {
  id: string
  isPresent: boolean
  initial: false | undefined
  onExitComplete: (childId: string) => void
  register: (childId: string) => () => void
}

export const PresenceContext = createContext<PresenceContextValue | null>(null)

export type SafeToRemove = () => void

export function usePresence(): [true] | [true, null] | [false, SafeToRemove] {
  const context = useContext(PresenceContext)
  const id = useId()
  const register = context?.register
  useLayoutEffect(() => {
    if (!register) return
    return register(id)
  }, [id, register])

  const onExitComplete = context?.onExitComplete
  const safeToRemove = useCallback(() => {
    onExitComplete?.(id)
  }, [id, onExitComplete])

  if (context === null) return [true, null]
  return !context.isPresent ? [false, safeToRemove] : [true]
}

export function useIsPresent(): boolean {
  const context = useContext(PresenceContext)
  return context === null ? true : context.isPresent
}

export interface AnimatePresenceProps {
  children?: ReactNode
  /** Skip enter animations for children present on the first render. */
  initial?: boolean
  /** Fires when every exiting child has finished. */
  onExitComplete?: () => void
}

function getChildKey(child: ReactElement): ComponentKey {
  return child.key ?? ""
}

function onlyElements(children: ReactNode): ReactElement[] {
  const filtered: ReactElement[] = []
  Children.forEach(children, (child) => {
    if (isValidElement(child)) filtered.push(child)
  })
  return filtered
}

function PresenceChild({
  children,
  isPresent,
  initial,
  onExitComplete,
}: {
  children: ReactElement
  isPresent: boolean
  initial: false | undefined
  onExitComplete?: () => void
}) {
  const presenceChildren = useRef(
    new Map<string, PresenceContextValue["onExitComplete"] | null>()
  ).current
  const id = useId()
  const isPresentRef = useRef(isPresent)
  const onExitCompleteRef = useRef(onExitComplete)

  useLayoutEffect(() => {
    isPresentRef.current = isPresent
    onExitCompleteRef.current = onExitComplete
  }, [isPresent, onExitComplete])

  const register = useCallback((childId: string) => {
    presenceChildren.set(childId, null)
    return () => {
      presenceChildren.delete(childId)
      queueMicrotask(() => {
        if (!isPresentRef.current && presenceChildren.size === 0) {
          onExitCompleteRef.current?.()
        }
      })
    }
  }, [presenceChildren])

  const completeCycle = useMemo(() => {
    const complete: PresenceContextValue["onExitComplete"] = (childId) => {
      if (!presenceChildren.has(childId)) return
      presenceChildren.set(childId, complete)
      for (const completedBy of presenceChildren.values()) {
        if (completedBy !== complete) return
      }
      onExitCompleteRef.current?.()
    }
    return complete
  }, [isPresent, presenceChildren])

  const context = useMemo(
    (): PresenceContextValue => ({
      id,
      initial,
      isPresent,
      onExitComplete: completeCycle,
      register,
    }),
    [completeCycle, id, initial, isPresent, register]
  )

  useEffect(() => {
    if (!isPresent && presenceChildren.size === 0) onExitCompleteRef.current?.()
  }, [isPresent, presenceChildren])

  return createElement(PresenceContext.Provider, { value: context }, children)
}

export function AnimatePresence({
  children,
  initial = true,
  onExitComplete,
}: AnimatePresenceProps): ReactElement {
  const presentChildren = useMemo(() => onlyElements(children), [children])
  const presentKeys = new Set(presentChildren.map(getChildKey))
  const isInitialRender = useRef(true)
  const exitComplete = useRef(new Map<ComponentKey, boolean>()).current
  const [renderedChildren, setRenderedChildren] = useState(presentChildren)

  useLayoutEffect(() => {
    isInitialRender.current = false
    for (const child of renderedChildren) {
      const key = getChildKey(child)
      if (!presentKeys.has(key)) {
        if (exitComplete.get(key) !== true) exitComplete.set(key, false)
      } else {
        exitComplete.delete(key)
      }
    }
  }, [exitComplete, presentChildren, renderedChildren])

  const nextChildren = [...presentChildren]
  for (let i = 0; i < renderedChildren.length; i++) {
    const child = renderedChildren[i]
    const key = getChildKey(child)
    if (!presentKeys.has(key)) nextChildren.splice(i, 0, child)
  }

  useLayoutEffect(() => {
    if (
      nextChildren.length !== renderedChildren.length ||
      nextChildren.some((child, index) => child !== renderedChildren[index])
    ) {
      setRenderedChildren(nextChildren)
    }
  }, [nextChildren, renderedChildren])

  return createElement(
    Fragment,
    null,
    ...nextChildren.map((child) => {
      const key = getChildKey(child)
      const isPresent = presentKeys.has(key)
      const onExit = () => {
        if (exitComplete.get(key) === true) return
        exitComplete.set(key, true)
        let isEveryExitComplete = true
        exitComplete.forEach((isExitComplete) => {
          if (!isExitComplete) isEveryExitComplete = false
        })
        if (!isEveryExitComplete) return
        exitComplete.clear()
        setRenderedChildren(presentChildren)
        onExitComplete?.()
      }
      return createElement(PresenceChild, {
        key,
        isPresent,
        initial: isInitialRender.current && initial === false ? false : undefined,
        onExitComplete: isPresent ? undefined : onExit,
        children: child,
      })
    })
  )
}
