/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

/** Bound connection/first-byte latency without cutting off a long video response body. */
export async function fetchMedia(url: string, init: RequestInit, headerTimeout = 4000) {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), headerTimeout);
  try {
    return await fetch(url, {
      ...init,
      signal: AbortSignal.any([deadline.signal, ...(init.signal ? [init.signal] : [])]),
    });
  } finally {
    clearTimeout(timer);
  }
}
