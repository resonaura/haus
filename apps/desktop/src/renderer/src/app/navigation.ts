/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

export type Route =
  | {
      kind:
        | 'home'
        | 'automations'
        | 'scenes'
        | 'cameras'
        | 'attention'
        | 'settings'
        | 'nvr'
        | 'servers'
        | 'statistics'
        | 'favorites'
        | 'hidden'
        | 'rooms'
        | 'addons';
    }
  | { kind: 'integrations'; section?: 'repairs' | 'updates' }
  | { kind: 'devices'; areaId?: string }
  | { kind: 'room' | 'category'; id: string };
