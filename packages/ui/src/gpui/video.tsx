/* @jsxImportSource @gpuix/react */
/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useLayoutEffect, useRef } from 'react';
import type { ImgInstance, StyleDesc } from '@gpuix/react';
import type { HostVideoProps } from '../renderers/host.js';

const transparentPixel = new Uint8Array(4);

export function GpuiVideo({ video, style }: { video: HostVideoProps; style: StyleDesc }) {
  const image = useRef<ImgInstance>(null);
  const callbacks = useRef(video);
  const { frameSource, id, poster } = video;
  useLayoutEffect(() => {
    callbacks.current = video;
  });

  useLayoutEffect(() => {
    const target = image.current;
    if (!target) return;
    const controller = new AbortController();
    const { signal } = controller;
    void (async () => {
      let receivedFrame = false;
      try {
        if (!frameSource) throw new Error('No native video source.');
        target.setImagePixels(1, 1, transparentPixel);
        for await (const frame of frameSource(signal)) {
          if (signal.aborted) return;
          target.setImagePixels(frame.width, frame.height, frame.pixels, { format: frame.format });
          if (!receivedFrame) {
            receivedFrame = true;
            callbacks.current.onPlaying?.();
          }
        }
        if (!receivedFrame) throw new Error('No frames received.');
        if (!signal.aborted) callbacks.current.onEnded?.();
      } catch {
        if (!signal.aborted) callbacks.current.onError?.({ currentTime: 0, duration: NaN, target });
      }
    })();
    return () => controller.abort();
  }, [frameSource]);

  return (
    <img
      ref={image}
      testId={id}
      src={frameSource ? undefined : poster}
      style={style}
      objectFit={video.objectFit ?? 'contain'}
    />
  );
}
