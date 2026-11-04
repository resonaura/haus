/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import type { StreamOption } from '../contracts.js';
/** Prefer measured resolution over display-name hints; do not reconfigure the camera. */
export function selectStreams(options: readonly StreamOption[]) {
  const video = options.filter((option) => option.video && typeof option.id === 'string');
  if (!video.length) throw Error('kitsune_no_video_stream');
  const score = (option: StreamOption) => (option.video?.width ?? 0) * (option.video?.height ?? 0);
  const ranked = [...video].sort(
    (a, b) =>
      score(b) - score(a) ||
      (b.video?.bitrate ?? 0) - (a.video?.bitrate ?? 0) ||
      Number(/main|hd/i.test(b.name ?? '')) - Number(/main|hd/i.test(a.name ?? '')) ||
      String(a.id).localeCompare(String(b.id)),
  );
  return { recording: ranked[0], preview: ranked.at(-1)! };
}
