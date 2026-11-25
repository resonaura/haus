/// GPUI debug frame overlay: mode cycling and a visual paint check.

import fs from "fs"
import path from "path"
import React from "react"
import { beforeAll, describe, expect, it } from "vitest"
import { render, resetRender } from "../reconciler/renderer.js"
import { createTestRoot, hasNativeTestRenderer, TestRenderer } from "../testing.js"
import { expectScreenshotsDiffer, SHOTS_DIR } from "./test-utils.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

beforeAll(() => {
  fs.mkdirSync(SHOTS_DIR, { recursive: true })
})

describeNative("debug frame overlay", () => {
  it("defaults to hidden and cycles hidden → minimal → full → hidden", () => {
    const { renderer } = createTestRoot()
    expect(renderer.getDebugFrameOverlay()).toBe("hidden")
    expect(renderer.cycleDebugFrameOverlay()).toBe("minimal")
    expect(renderer.cycleDebugFrameOverlay()).toBe("full")
    expect(renderer.cycleDebugFrameOverlay()).toBe("hidden")
  })

  it("sets a mode and keeps it after reset", () => {
    const { renderer } = createTestRoot()
    expect(renderer.setDebugFrameOverlay("full")).toBe("full")
    expect(renderer.getDebugFrameOverlay()).toBe("full")
    renderer.resetDebugFrameOverlayStats()
    expect(renderer.getDebugFrameOverlay()).toBe("full")
  })

  it("returns recorded draw stats after flush", () => {
    const { render, renderer } = createTestRoot()
    render(
      <div style={{ backgroundColor: "#111111", width: "100%", height: "100%" }} />
    )
    renderer.resetDebugFrameOverlayStats()
    renderer.flush()
    const stats = renderer.getDebugFrameOverlayStats()
    expect(stats.samples).toBeGreaterThan(0)
    expect(stats.frames).toBeGreaterThan(0)
    expect(stats.currentMs).toBeTypeOf("number")
    expect(stats.maxMs).toBeGreaterThanOrEqual(stats.currentMs ?? 0)
  })

  it("rejects an unknown mode", () => {
    const { renderer } = createTestRoot()
    expect(() => renderer.setDebugFrameOverlay("nope" as "full")).toThrow(
      /hidden, minimal, or full/
    )
  })

  it("applies render({ debugFrameOverlay }) on the injected renderer", () => {
    resetRender()
    const renderer = new TestRenderer()
    render(<div style={{ backgroundColor: "#111111", width: "100%", height: "100%" }} />, {
      renderer,
      debugFrameOverlay: "minimal",
    })
    expect(renderer.getDebugFrameOverlay()).toBe("minimal")
  })

  it("paints the overlay into the window screenshot", () => {
    const before = path.join(SHOTS_DIR, "debug-frame-overlay-off.png")
    const after = path.join(SHOTS_DIR, "debug-frame-overlay-full.png")
    const { render: mount, renderer } = createTestRoot()
    mount(
      <div
        style={{
          backgroundColor: "#111111",
          width: "100%",
          height: "100%",
        }}
      />
    )
    renderer.captureScreenshot(before)
    renderer.setDebugFrameOverlay("full")
    renderer.captureScreenshot(after)
    expectScreenshotsDiffer(before, after)
  })
})
