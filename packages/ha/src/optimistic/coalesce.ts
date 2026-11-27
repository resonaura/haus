/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

export {
  HAUS_SCENE_QUEUE_KEY,
  actionQueueKey,
  coalesceHausActions,
  dispatchQueuedHausAction,
  extractContextId,
  isCoalesceableLightAction,
  isStatelessAction,
  mergeLightActions,
} from '@haus/core/optimistic';
