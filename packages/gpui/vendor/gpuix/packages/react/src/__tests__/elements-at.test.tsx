import { describe, expect, it } from "vitest"
import { createTestRoot, hasNativeTestRenderer } from "../testing.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

describeNative("getElementsAt", () => {
  const idsAt = (
    renderer: ReturnType<typeof createTestRoot>["renderer"],
    x: number,
    y: number
  ) => renderer.getElementsAt(x, y)

  it("lists the elements under a point, topmost first, and honors clipping", () => {
    const { render, renderer, unmount } = createTestRoot()
    try {
      render(
        <div style={{ display: "flex", flexDirection: "row", width: 400, height: 300 }}>
          <div
            testId="scroller"
            style={{ width: 100, height: 100, overflow: "hidden", flexDirection: "column" }}
          >
            <div testId="row" style={{ width: 100, height: 160, flexShrink: 0 }} />
          </div>
          <div testId="beside" style={{ width: 80, height: 80 }} />
        </div>
      )
      renderer.dispatchNativeEvents()
      const id = (testId: string) => renderer.findByTestId(testId)!.id

      expect(idsAt(renderer, 50, 50).slice(0, 2)).toEqual([id("row"), id("scroller")])
      expect(
        idsAt(renderer, 50, 130),
        "the row extends below the scroller, which clips it"
      ).not.toContain(id("row"))
      expect(idsAt(renderer, 150, 50)).toContain(id("beside"))
      expect(idsAt(renderer, 5000, 5000)).toEqual([])
    } finally {
      unmount()
    }
  })

  it("puts an <anchored> popover above what follows it in the tree", () => {
    const { render, renderer, unmount } = createTestRoot()
    try {
      render(
        <div style={{ width: 400, height: 300 }}>
          <div testId="trigger" style={{ width: 60, height: 30 }}>
            <anchored position={{ x: 20, y: 20 }} anchor="topLeft" deferred priority={1}>
              <div testId="popover" style={{ width: 100, height: 100 }} />
            </anchored>
          </div>
          <div testId="later" style={{ position: "absolute", left: 0, top: 0, width: 200, height: 200 }} />
        </div>
      )
      renderer.dispatchNativeEvents()
      const id = (testId: string) => renderer.findByTestId(testId)!.id

      const hits = idsAt(renderer, 40, 40)
      expect(hits.indexOf(id("popover")), "the popover is hit").toBeGreaterThanOrEqual(0)
      expect(hits.indexOf(id("popover"))).toBeLessThan(hits.indexOf(id("later")))
    } finally {
      unmount()
    }
  })

  it("skips pointer-events: none and lets a child opt back in", () => {
    const { render, renderer, unmount } = createTestRoot()
    try {
      render(
        <div style={{ width: 200, height: 200 }}>
          <div
            testId="overlay"
            style={{ position: "absolute", left: 0, top: 0, width: 200, height: 200, pointerEvents: "none" }}
          >
            <div testId="button" style={{ width: 40, height: 40, pointerEvents: "auto" }} />
          </div>
        </div>
      )
      renderer.dispatchNativeEvents()
      const hits = idsAt(renderer, 10, 10)
      expect(hits).toContain(renderer.findByTestId("button")!.id)
      expect(hits).not.toContain(renderer.findByTestId("overlay")!.id)
      expect(idsAt(renderer, 100, 100)).not.toContain(renderer.findByTestId("overlay")!.id)
    } finally {
      unmount()
    }
  })
})
