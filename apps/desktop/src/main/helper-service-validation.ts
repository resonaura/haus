/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

export { validateServiceOperation, recordingSource } from '@haus/ha/helper-service-validation';

/** Error surfaced when a Haus helper operation returns a structured failure code. */
export class HelperOperationError extends Error {
  constructor(readonly code: string) {
    super(code.replaceAll('_', ' '));
  }
}

/** Parses JSON from a bounded helper HTTP response, throwing contextual errors on failure. */
export async function parseHelperJson(
  response: Response,
  onInvalidJson: () => string,
): Promise<unknown> {
  const text = await response.text();
  if (text.length > 4000000) throw new Error('Haus returned too much timeline data.');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(onInvalidJson());
  }
}

/** Releases active camera warm and viewer leases held on a surface during cleanup. */
export function releaseSurfaceLeases(
  surface: { url: string; cookie?: string },
  warmCameras: Iterable<[string, string]>,
  viewers: Iterable<{ camera: string; viewerId: string }>,
  warmOwner: string,
): void {
  const release = (path: string, data: Record<string, unknown>) =>
    void fetch(new URL(path, surface.url), {
      method: 'POST',
      body: JSON.stringify(data),
      headers: {
        'Content-Type': 'application/json',
        'X-Haus-Client': '1',
        ...(surface.cookie ? { Cookie: `ingress_session=${surface.cookie}` } : {}),
      },
      signal: AbortSignal.timeout(5000),
      redirect: 'error',
    })
      .then((response) => response.body?.cancel())
      .catch(() => {});
  for (const [key, id] of warmCameras)
    release(`api/cameras/${id}/warm`, { active: false, owner: key.slice(id.length + 1) });
  for (const entry of viewers)
    release(`api/cameras/${entry.camera}/viewer/close`, {
      viewerId: entry.viewerId,
      owner: warmOwner,
    });
}
