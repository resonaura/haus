/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { nativeApi } from '../../ha/management';

export type {
  CommunityRepository,
  CriticalRepository,
  HacsInfo,
  HacsScope,
} from '@haus/core/transport';
export {
  communityRepositoryName,
  filterCommunity,
  formatHacsRepositoryError,
} from '@haus/core/transport';

export const hacs = <T>(command: string, fields: Record<string, unknown> = {}) =>
  nativeApi().request<T>({ type: `hacs/${command}`, ...fields });
