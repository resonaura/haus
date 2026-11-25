import { describe, expect, it } from "vitest"
import { useGpuix } from "../hooks/use-gpuix.js"
import { createTestRoot, hasNativeTestRenderer } from "../testing.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

describeNative("root context", () => {
  // An app shell reads the renderer and passes `memo` rows a fresh callback
  // whenever it re-renders. If every `root.render()` counted as a context
  // change, one keystroke in the shell would re-render every row below it.
  it("does not re-render useGpuix consumers when the root renders again", () => {
    const { render, unmount } = createTestRoot()
    try {
      let renders = 0
      function Shell() {
        useGpuix()
        renders++
        return <div />
      }
      const shell = <Shell />

      render(shell)
      render(shell)
      render(shell)

      expect(renders).toBe(1)
    } finally {
      unmount()
    }
  })
})
