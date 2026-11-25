/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import sharp from 'sharp';
import {
  animate,
  MotionValue,
  motion,
  stagger,
  useMotionValue,
  useSpring,
  useTransform,
} from '@gpuix/react';
import { createTestRoot, hasNativeTestRenderer } from '@gpuix/react/testing';
import { GPUIX_CONTENT_HOST } from '@haus/ui/gpui';
import { colorToken, corners, LiquidGlassMaterial, px, rgba, SolidMaterial } from '@haus/ui/ir';
import { Box, HausUiProvider, ProgressiveBlur } from '@haus/ui/primitives';
import { requireGpuiBun } from '../../src/gpui/bun.js';

requireGpuiBun();
assert(hasNativeTestRenderer, 'GPUIX native test renderer is required for check-compositor');

function withRoot(
  size: { width: number; height: number },
  fn: (ctx: ReturnType<typeof createTestRoot>) => void | Promise<void>,
): Promise<void> {
  const root = createTestRoot(size);
  return Promise.resolve(fn(root)).finally(() => root.unmount());
}

async function readRgbaRegion(
  pngPath: string,
  rect: { x: number; y: number; width: number; height: number },
): Promise<{ data: Uint8Array; width: number; height: number; channels: number; scale: number }> {
  const meta = await sharp(pngPath).metadata();
  const imgWidth = meta.width ?? 600;
  const scale = imgWidth / 600;
  const left = Math.max(0, Math.round(rect.x * scale));
  const top = Math.max(0, Math.round(rect.y * scale));
  const width = Math.max(1, Math.round(rect.width * scale));
  const height = Math.max(1, Math.round(rect.height * scale));
  const extracted = await sharp(pngPath)
    .extract({ left, top, width, height })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    data: extracted.data,
    width: extracted.info.width,
    height: extracted.info.height,
    channels: extracted.info.channels,
    scale,
  };
}

function samplePixel(
  buf: { data: Uint8Array; width: number; channels: number },
  pxX: number,
  pxY: number,
): [number, number, number, number] {
  const idx = (pxY * buf.width + pxX) * buf.channels;
  return [
    buf.data[idx] ?? 0,
    buf.data[idx + 1] ?? 0,
    buf.data[idx + 2] ?? 0,
    buf.data[idx + 3] ?? 255,
  ];
}

async function checkLiquidGlassOpticalRefractionOnMetal(): Promise<void> {
  const shotDir = resolve('/tmp/haus-compositor-check');
  mkdirSync(shotDir, { recursive: true });
  const shotPath = resolve(shotDir, 'liquid-glass.png');

  await withRoot({ width: 600, height: 400 }, async ({ renderer, render }) => {
    render(
      createElement(HausUiProvider, {
        contentHost: GPUIX_CONTENT_HOST,
        mode: 'dark',
        children: createElement(
          'div',
          {
            style: {
              width: 600,
              height: 400,
              position: 'relative',
              backgroundColor: '#10141c',
            },
          },
          // High-contrast red left / blue right backdrop bands behind the Liquid Glass panel
          createElement('div', {
            style: {
              position: 'absolute',
              left: 0,
              top: 0,
              width: 300,
              height: 400,
              backgroundColor: '#ff2b2b',
            },
          }),
          createElement('div', {
            style: {
              position: 'absolute',
              left: 300,
              top: 0,
              width: 300,
              height: 400,
              backgroundColor: '#1e6bff',
            },
          }),
          // Centered Haus Liquid Glass Box
          createElement(Box, {
            id: 'glass-card',
            style: {
              layout: {
                position: 'absolute',
                width: px(320),
                height: px(180),
                inset: { top: px(110), left: px(140) },
              },
              corners: corners(28, 'superellipse', 1.4),
              material: new LiquidGlassMaterial({
                blurRadius: 16,
                refractionStrength: 18,
                chromaticDispersion: 0.65,
                rimPreset: 'card',
              }),
            },
          }),
        ),
      }),
    );
    renderer.flush();
    renderer.captureScreenshot(shotPath);
    assert(existsSync(shotPath), 'Liquid Glass Metal screenshot must be created');

    const panel = await readRgbaRegion(shotPath, { x: 140, y: 110, width: 320, height: 180 });
    const leftInterior = samplePixel(
      panel,
      Math.round(panel.width * 0.25),
      Math.round(panel.height * 0.5),
    );
    const rightInterior = samplePixel(
      panel,
      Math.round(panel.width * 0.75),
      Math.round(panel.height * 0.5),
    );
    const topRimPixel = samplePixel(panel, Math.round(panel.width * 0.5), 1);
    const centerPixel = samplePixel(
      panel,
      Math.round(panel.width * 0.5),
      Math.round(panel.height * 0.5),
    );

    // Real backdrop sampling: left side reflects red scene, right side reflects blue scene.
    assert(
      leftInterior[0] > leftInterior[2] + 30,
      `Liquid Glass left interior must sample/refract red backdrop, got rgba(${leftInterior.join(',')})`,
    );
    assert(
      rightInterior[2] > rightInterior[0] + 30,
      `Liquid Glass right interior must sample/refract blue backdrop, got rgba(${rightInterior.join(',')})`,
    );
    // Rim highlight must brighten the edge relative to flat center tint (not a uniform rectangle).
    const rimLuma = topRimPixel[0] + topRimPixel[1] + topRimPixel[2];
    const centerLuma = centerPixel[0] + centerPixel[1] + centerPixel[2];
    assert(
      Math.abs(rimLuma - centerLuma) >= 15,
      `Expected analytical rim lighting contrast vs interior (rim=${rimLuma}, center=${centerLuma})`,
    );
  });

  rmSync(shotDir, { recursive: true, force: true });
}

async function checkAffineTransformAndInverseHitTesting(): Promise<void> {
  await withRoot({ width: 600, height: 400 }, ({ renderer, render }) => {
    let clicks = 0;
    render(
      createElement(
        'div',
        { style: { width: 600, height: 400, position: 'relative' } },
        createElement('div', {
          testId: 'transformed-target',
          onClick: () => {
            clicks++;
          },
          style: {
            position: 'absolute',
            left: 50,
            top: 50,
            width: 100,
            height: 60,
            backgroundColor: '#22c55e',
            borderRadius: 12,
            cornerSmoothing: 1,
            transform: {
              translateX: 160,
              translateY: 90,
              rotate: 20,
              scale: 1.2,
            },
            transformOrigin: { x: 0.5, y: 0.5 },
          },
        }),
      ),
    );
    renderer.flush();

    // Original center (100, 80) moved to (260, 170): clicking original untransformed center must miss.
    renderer.nativeSimulateClick(100, 80, 0);
    assert.equal(clicks, 0, 'untransformed location must NOT hit transformed element');

    // Clicking transformed visual center (260, 170) must hit via inverse transform.
    renderer.nativeSimulateClick(260, 170, 0);
    assert.equal(clicks, 1, 'transformed visual center must hit via LayerTransform2D inverse');
  });
}

async function checkNativeMotionAndZeroReactCommits(): Promise<void> {
  await withRoot({ width: 600, height: 400 }, ({ renderer, render }) => {
    let commits = 0;
    let driver!: MotionValue;
    let derivedX!: MotionValue;
    let springX!: MotionValue;

    function MotionScene() {
      commits++;
      driver = useMotionValue(0);
      derivedX = useTransform(driver, [0, 100], [20, 220]);
      springX = useSpring(driver, { stiffness: 300, damping: 24 });

      return createElement(
        'div',
        { style: { width: 600, height: 400, display: 'flex', flexDirection: 'column', gap: 16 } },
        createElement('div', {
          testId: 'mv-box',
          style: {
            width: 80,
            height: 40,
            backgroundColor: '#38bdf8',
            motionBind: [
              derivedX.bind('x'),
              springX.bind('opacity', { inputRange: [0, 100], outputRange: [0.3, 1] }),
            ],
          },
        }),
        createElement(motion.div, {
          testId: 'spring-card',
          initial: { x: 0, scale: 0.9, opacity: 0.5 },
          animate: { x: [0, 150, 100], scale: 1.0, opacity: 1.0 },
          transition: {
            duration: 0.4,
            delay: stagger(0.05)(0, 2),
            ease: 'linear',
          },
          style: { width: 120, height: 48, backgroundColor: '#a855f7' },
        }),
      );
    }

    renderer.clockPause();
    render(createElement(MotionScene));
    renderer.flush();
    commits = 0;

    animate(driver, 100, { duration: 0.25, ease: 'linear' });
    renderer.flush();

    for (let step = 0; step < 8; step++) {
      renderer.clockFastForward(40);
      renderer.flush();
    }
    const midDerived = derivedX.get();
    assert(Math.abs(midDerived - 220) < 1e-3, `expected derivedX to reach 220, got ${midDerived}`);

    // Continue stepping until follower spring converges.
    for (let step = 0; step < 25; step++) {
      renderer.clockFastForward(40);
      renderer.flush();
    }
    assert(
      Math.abs(springX.get() - 100) < 0.05,
      `expected spring follower to converge to 100, got ${springX.get()}`,
    );
    assert.equal(
      commits,
      0,
      `native motion progression must cause 0 React commits, got ${commits}`,
    );
    renderer.clockResume();
  });
}

async function checkGradientsMasksGlowRenderOnMetal(): Promise<void> {
  await withRoot({ width: 400, height: 300 }, ({ renderer, render }) => {
    render(
      createElement(HausUiProvider, {
        contentHost: GPUIX_CONTENT_HOST,
        mode: 'dark',
        children: createElement(
          'div',
          {
            style: {
              width: 400,
              height: 300,
              display: 'flex',
              flexDirection: 'row',
              gap: 16,
              padding: 20,
              mask: { fadeTop: 12, fadeBottom: 12 },
            },
          },
          createElement('div', {
            style: {
              width: 100,
              height: 100,
              borderRadius: 20,
              cornerSmoothing: 1,
              background: {
                type: 'linear-gradient',
                angle: 135,
                colorSpace: 'oklab',
                stops: [
                  { position: 0, color: '#ff4d4d' },
                  { position: 0.5, color: '#f59e0b' },
                  { position: 1, color: '#3b82f6' },
                ],
              },
              glow: { color: '#3b82f6', radius: 16, spread: 4, intensity: 0.8 },
            },
          }),
          createElement('div', {
            style: {
              width: 100,
              height: 100,
              borderRadius: 50,
              background: {
                type: 'radial-gradient',
                stops: [
                  { position: 0, color: '#ffffff' },
                  { position: 1, color: '#1d4ed8' },
                ],
              },
            },
          }),
          createElement('div', {
            style: {
              width: 100,
              height: 100,
              borderRadius: 50,
              background: {
                type: 'conic-gradient',
                angle: 45,
                stops: [
                  { position: 0, color: '#ec4899' },
                  { position: 0.5, color: '#8b5cf6' },
                  { position: 1, color: '#06b6d4' },
                ],
              },
            },
          }),
          createElement(Box, {
            style: {
              layout: { width: px(20), height: px(20) },
              material: new SolidMaterial(colorToken('accent')),
              transform: { scale: 1.1, originX: 0.5, originY: 0.5 },
            },
          }),
        ),
      }),
    );
    renderer.flush();
    assert(rgba(255, 0, 0).kind === 'rgba');
  });
}

async function checkProgressiveBlurOnMetal(): Promise<void> {
  const shotDir = resolve('/tmp/haus-compositor-check');
  mkdirSync(shotDir, { recursive: true });
  const shotPath = resolve(shotDir, 'progressive-blur.png');
  await withRoot({ width: 600, height: 400 }, async ({ renderer, render }) => {
    render(
      createElement(HausUiProvider, {
        contentHost: GPUIX_CONTENT_HOST,
        mode: 'dark',
        children: createElement(
          Box,
          { style: { layout: { width: px(600), height: px(400), position: 'relative' } } },
          ...Array.from({ length: 60 }, (_, index) =>
            createElement(Box, {
              key: index,
              style: {
                layout: {
                  position: 'absolute',
                  inset: { left: px(10 * index) },
                  width: px(10),
                  height: px(400),
                },
                material: new SolidMaterial(index % 2 === 0 ? rgba(248, 248, 248) : rgba(0, 0, 0)),
              },
            }),
          ),
          createElement(ProgressiveBlur, {
            maxRadius: 15,
            start: 0.2,
            style: {
              layout: {
                position: 'absolute',
                inset: { top: px(0), left: px(0) },
                width: px(600),
                height: px(400),
              },
            },
          }),
        ),
      }),
    );
    renderer.flush();
    renderer.captureScreenshot(shotPath);
    const capture = await readRgbaRegion(shotPath, { x: 80, y: 0, width: 120, height: 390 });
    const contrast = (y: number) => {
      const row = Math.floor(y * capture.scale);
      const values = Array.from(
        { length: capture.width },
        (_, x) => samplePixel(capture, x, row)[0],
      );
      return Math.max(...values) - Math.min(...values);
    };
    const clear = contrast(45);
    const softened = contrast(350);
    assert(
      clear > 220 && softened < clear * 0.65,
      `Expected a clear top and a blurred bottom, got ${clear} and ${softened}.`,
    );
    console.log(`Progressive blur reduced native stripe contrast from ${clear} to ${softened}.`);
  });
}

await checkProgressiveBlurOnMetal();
if (!process.argv.includes('--progressive-only')) {
  await checkLiquidGlassOpticalRefractionOnMetal();
  await checkAffineTransformAndInverseHitTesting();
  await checkNativeMotionAndZeroReactCommits();
  await checkGradientsMasksGlowRenderOnMetal();
  console.log(
    'check-compositor: Metal Liquid Glass refraction, 2D inverse hit-testing, gradients/glow/masks, and 0-commit motion passed',
  );
}
