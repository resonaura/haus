/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { ORIGINAL_POLICY_VERSION } from './compatible.mjs';
export { playbackArguments, inspectPlaybackCadence as inspectCadence } from '@haus/media/pipeline';

export const PLAYBACK_VERSION = 4;

export function playbackReady(event) {
  if (event.playbackVersion !== PLAYBACK_VERSION) return false;
  // 0.3.19 inferred original compatibility from timing alone. Invalidate only
  // those unsafe markers; old normalized copies keep their proven playback.
  return (
    event.playbackBytes > 0 ||
    event.playbackInfo?.originalCompatible !== true ||
    event.playbackInfo?.originalPolicyVersion === ORIGINAL_POLICY_VERSION
  );
}
