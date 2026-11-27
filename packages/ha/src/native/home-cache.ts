/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createHash } from 'node:crypto';
import { HomeCache as CoreHomeCache } from '@haus/core/hub';
import type { CredentialStore, StoredSession } from '../native-types.js';
import type { Snapshot } from '../types.js';

export const homeCacheScope = (session: StoredSession): string =>
  createHash('sha256')
    .update(JSON.stringify([session.url, session.clientId, session.refreshToken]))
    .digest('hex');

/** Session-bound encrypted cache for Home Assistant snapshots. */
export class HomeCache extends CoreHomeCache<Snapshot> {
  constructor(
    store: Pick<CredentialStore, 'loadHomeCache' | 'saveHomeCache'>,
    scope: () => string | undefined,
  ) {
    super(store, scope);
  }
}
