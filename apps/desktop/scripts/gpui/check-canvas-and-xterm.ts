/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import assert from 'node:assert/strict';
import { existsSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { createDemoSnapshot } from '@haus/ha/view/demo/snapshot';
import { createTestRoot, hasNativeTestRenderer, type TestRenderer } from '@gpuix/react/testing';
import {
  createNativeCanvas,
  GPUIX_CONTENT_HOST,
  installGpuiCanvasGlobals,
  type GpuiCanvasElement,
} from '@haus/ui/gpui';
import { colorToken, corners, insets, pct, px, rgba, SolidMaterial } from '@haus/ui/ir';
import { Box, CanvasSurface, HausUiProvider, Heading, Row, Stack, Text } from '@haus/ui/primitives';
import { requireGpuiBun } from '../../src/gpui/bun.js';
import { GpuiServersView } from '../../src/gpui/management/servers.js';

requireGpuiBun();
assert(hasNativeTestRenderer, 'GPUIX native test renderer is required');
installGpuiCanvasGlobals();

const captureDir = process.env.HAUS_VISUAL_OUT_DIR;
const scratchDir = captureDir ?? tmpdir();

function captureAndAssert(renderer: TestRenderer, filename: string, minBytes: number): void {
  const outPath = join(scratchDir, filename);
  renderer.captureScreenshot(outPath);
  assert(existsSync(outPath), `Screenshot missing at ${outPath}`);
  const size = statSync(outPath).size;
  assert(size > minBytes, `Expected screenshot ${filename} > ${minBytes} bytes, got ${size}`);
  if (!captureDir) rmSync(outPath, { force: true });
}

function click(renderer: TestRenderer, id: string): void {
  const el = renderer.findByTestId(id);
  assert(el, `Missing testId="${id}"`);
  const b = renderer.getElementBounds(el.id);
  assert(b && b.width > 0 && b.height > 0, `Missing bounds for "${id}"`);
  renderer.nativeSimulateClick(b.x + b.width / 2, b.y + b.height / 2, 0);
  renderer.dispatchNativeEvents();
  renderer.flush();
}

function typeTerminal(renderer: TestRenderer, text: string): void {
  const el = renderer.findByTestId('server-terminal-xterm');
  assert(el, 'Missing xterm element');
  const keys = text
    .split('')
    .map((c) => (c === ' ' ? 'space' : c))
    .join(' ');
  renderer.nativeSimulateKeystrokes(el.id, `${keys} enter`);
  renderer.dispatchNativeEvents();
  renderer.flush();
}

async function flush(renderer: TestRenderer, turns = 8): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await new Promise((r) => setTimeout(r, 12));
    renderer.dispatchNativeEvents();
    renderer.flush();
  }
}

function CanvasAndThreeDemo({ onThreeError }: { readonly onThreeError: (err: number) => void }) {
  const canvas2dRef = useRef<GpuiCanvasElement | null>(null);
  const threeRef = useRef<GpuiCanvasElement | null>(null);

  useEffect(() => {
    const c2d = canvas2dRef.current;
    if (c2d) {
      const ctx = c2d.getContext('2d');
      if (ctx) {
        const w = c2d.width;
        const h = c2d.height;
        const grad = ctx.createLinearGradient(0, 0, w, h);
        grad.addColorStop(0, '#0f172a');
        grad.addColorStop(1, '#1e293b');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);

        ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)';
        ctx.lineWidth = 1;
        for (let x = 40; x < w; x += 60) {
          ctx.beginPath();
          ctx.moveTo(x, 40);
          ctx.lineTo(x, h - 48);
          ctx.stroke();
        }
        for (let y = 60; y < h - 40; y += 50) {
          ctx.beginPath();
          ctx.moveTo(40, y);
          ctx.lineTo(w - 40, y);
          ctx.stroke();
        }

        const curveGrad = ctx.createLinearGradient(0, 60, 0, h - 48);
        curveGrad.addColorStop(0, 'rgba(56, 189, 248, 0.45)');
        curveGrad.addColorStop(1, 'rgba(56, 189, 248, 0.02)');
        ctx.beginPath();
        ctx.moveTo(40, h - 48);
        for (let i = 0; i <= 40; i++) {
          const x = 40 + ((w - 80) * i) / 40;
          const y = h * 0.55 - Math.sin(i * 0.28) * 75 - Math.cos(i * 0.13) * 32;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(w - 40, h - 48);
        ctx.closePath();
        ctx.fillStyle = curveGrad;
        ctx.fill();

        ctx.beginPath();
        for (let i = 0; i <= 40; i++) {
          const x = 40 + ((w - 80) * i) / 40;
          const y = h * 0.55 - Math.sin(i * 0.28) * 75 - Math.cos(i * 0.13) * 32;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 4;
        ctx.stroke();

        ctx.fillStyle = '#f8fafc';
        ctx.font = '600 28px sans-serif';
        ctx.fillText('Skia Canvas 2D · Retina', 40, 56);
        ctx.fillStyle = '#94a3b8';
        ctx.font = '400 18px sans-serif';
        ctx.fillText('Live telemetry waveform via @napi-rs/canvas', 40, 86);
        c2d.flush();
      }
    }

    const c3d = threeRef.current;
    if (!c3d) return;
    const texCanvas = createNativeCanvas(256, 256);
    const tctx = texCanvas.getContext('2d');
    if (tctx) {
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          tctx.fillStyle = (x + y) % 2 === 0 ? '#1e2433' : '#334155';
          tctx.fillRect(x * 32, y * 32, 32, 32);
        }
      }
      tctx.fillStyle = '#e2e8f0';
      tctx.font = 'bold 30px sans-serif';
      tctx.fillText('HAUS 3D', 58, 138);
    }

    const rendererOptions: Record<string, unknown> = { canvas: c3d, antialias: true };
    const glRenderer = new THREE.WebGLRenderer(rendererOptions as THREE.WebGLRendererParameters);
    glRenderer.shadowMap.enabled = true;
    glRenderer.setSize(c3d.width, c3d.height, false);
    glRenderer.setClearColor(0x090d16, 1);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, c3d.width / c3d.height, 0.1, 100);
    camera.position.set(0, 2.0, 4.7);
    camera.lookAt(0, -0.1, 0);

    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const keyLight = new THREE.DirectionalLight(0xffe6bd, 2.4);
    keyLight.position.set(4, 6, 5);
    keyLight.castShadow = true;
    scene.add(keyLight);
    const rimLight = new THREE.PointLight(0x38bdf8, 8, 14);
    rimLight.position.set(-3.2, 2.2, 2.0);
    scene.add(rimLight);

    const knot = new THREE.Mesh(
      new THREE.TorusKnotGeometry(0.95, 0.31, 128, 24),
      new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.48, roughness: 0.22 }),
    );
    knot.rotation.set(0.35, 0.72, 0.1);
    knot.castShadow = true;
    scene.add(knot);

    const floorTex = new THREE.CanvasTexture<GpuiCanvasElement>(texCanvas);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 8),
      new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.55, metalness: 0.1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -1.42;
    floor.receiveShadow = true;
    scene.add(floor);

    glRenderer.render(scene, camera);
    c3d.flush();
    onThreeError(glRenderer.getContext().getError());

    return () => {
      floorTex.dispose();
      glRenderer.dispose();
      texCanvas.dispose();
    };
  }, [onThreeError]);

  return createElement(
    Stack,
    {
      gapPx: 16,
      style: {
        layout: { width: pct(100), height: pct(100), padding: insets(24) },
        material: new SolidMaterial(rgba(10, 11, 15, 1)),
      },
    },
    createElement(
      Heading,
      { level: 2, size: 22, weight: 600 },
      'GPUIX Native Canvas 2D + Three.js WebGL 2',
    ),
    createElement(
      Row,
      { gapPx: 18, style: { layout: { width: pct(100), flexGrow: 1 } } },
      createElement(
        Stack,
        {
          gapPx: 8,
          style: {
            layout: { flexGrow: 1, flexBasis: px(0), minWidth: px(0) },
          },
        },
        createElement(Text, { size: 12, tone: 'muted' }, 'HTML5 Canvas 2D (@napi-rs/canvas)'),
        createElement(CanvasSurface, {
          id: 'gpui-demo-canvas-2d',
          canvasRef: canvas2dRef,
          width: 920,
          height: 600,
          style: {
            layout: { width: pct(100), height: px(360) },
            border: { width: 1, color: colorToken('border') },
            corners: corners(16),
          },
        }),
      ),
      createElement(
        Stack,
        {
          gapPx: 8,
          style: {
            layout: { flexGrow: 1, flexBasis: px(0), minWidth: px(0) },
          },
        },
        createElement(
          Text,
          { size: 12, tone: 'muted' },
          'Three.js r187 WebGL2 (Hardware OpenGL Core + ShadowMap)',
        ),
        createElement(CanvasSurface, {
          id: 'gpui-demo-three',
          canvasRef: threeRef,
          width: 920,
          height: 600,
          style: {
            layout: { width: pct(100), height: px(360) },
            border: { width: 1, color: colorToken('border') },
            corners: corners(16),
          },
        }),
      ),
    ),
  );
}

// 1. Verify Canvas 2D + Three.js WebGL2 inside real GPUIX Metal window
let threeGlErr = -1;
{
  const { renderer, render, unmount } = createTestRoot({ width: 1080, height: 520 });
  render(
    createElement(HausUiProvider, {
      contentHost: GPUIX_CONTENT_HOST,
      mode: 'dark',
      children: createElement(CanvasAndThreeDemo, {
        onThreeError: (err) => {
          threeGlErr = err;
        },
      }),
    }),
  );
  await flush(renderer, 10);
  assert.equal(threeGlErr, 0, `Expected Three.js gl.getError() === 0, got ${threeGlErr}`);
  captureAndAssert(renderer, 'canvas-and-three.png', 20_000);
  unmount();
}

// 2. Verify GPUIX xterm terminal (dark + search highlights, light, and ANSI logs)
async function checkXtermVisual(mode: 'dark' | 'light', tab: 'terminal' | 'logs', outName: string) {
  const snapshot = createDemoSnapshot();
  const { renderer, render, unmount } = createTestRoot({ width: 1080, height: 760 });
  render(
    createElement(HausUiProvider, {
      contentHost: GPUIX_CONTENT_HOST,
      mode,
      children: createElement(Box, {
        style: {
          layout: { width: pct(100), height: pct(100), padding: insets(20), overflowY: 'scroll' },
          material: new SolidMaterial(colorToken('background')),
        },
        children: createElement(GpuiServersView, { snapshot, demo: true }),
      }),
    }),
  );
  await flush(renderer, 8);
  click(renderer, 'server-card-haus-hub-main');
  await flush(renderer, 6);
  click(renderer, tab === 'terminal' ? 'server-tab-terminal' : 'server-tab-logs');
  await flush(renderer, 8);

  if (tab === 'terminal') {
    typeTerminal(renderer, 'help');
    await flush(renderer, 6);
    typeTerminal(renderer, 'docker ps');
    await flush(renderer, 6);
    typeTerminal(renderer, 'colors');
    await flush(renderer, 8);
    if (mode === 'dark') {
      click(renderer, 'console-search-toggle');
      await flush(renderer, 6);
      const searchEl = renderer.findByTestId('terminal-search-input');
      assert(searchEl, 'Missing terminal-search-input');
      renderer.writeToClipboard('healthy');
      renderer.nativeSimulateKeystrokes(searchEl.id, 'cmd-a backspace cmd-v');
      await flush(renderer, 8);
      assert(
        renderer.getAllText().some((t) => t.includes('1 / 3')),
        'Expected 3 search matches for "healthy" in xterm buffer',
      );
    }
  }

  captureAndAssert(renderer, outName, 15_000);
  unmount();
}

await checkXtermVisual('dark', 'terminal', 'xterm-dark.png');
await checkXtermVisual('light', 'terminal', 'xterm-light.png');
await checkXtermVisual('dark', 'logs', 'xterm-logs.png');

console.log(
  'check-canvas-and-xterm: Canvas 2D, Three.js WebGL2 (0 GL errors), and xterm dark/light/logs passed',
);
process.exit(0);
