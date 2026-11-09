/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { RadioAgent } from '@haus/core';

/** Registry of nearby radio agents (hub BLE, desktop, mobile). Empty until an agent registers. */
export class RadioAgentRegistry {
  private readonly agents = new Map<string, RadioAgent>();

  register(agent: RadioAgent): () => void {
    this.agents.set(agent.id, agent);
    return () => {
      this.agents.delete(agent.id);
    };
  }

  list(): RadioAgent[] {
    return Array.from(this.agents.values());
  }
}
