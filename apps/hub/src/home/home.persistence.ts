/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { HausAutomationRule, HausDevice, HausScene, HausScript } from '@haus/core';
import {
  StandaloneHomeEntryEntity,
  type StandaloneHomeEntryRow,
} from '../storage/standalone/entities.js';
import type { Transactions } from '../storage/transactions.js';
import type { InstalledAppEntry } from './app-driver.js';

export type StandaloneEntryKind =
  | 'device'
  | 'endpoint_state'
  | 'scene'
  | 'script'
  | 'automation'
  | 'app'
  | 'homekit_pairing'
  | 'ignored_matter_node';

export interface PersistedHomeSnapshot {
  devices: HausDevice[];
  endpointStates: Array<[string, Record<string, unknown>]>;
  scenes: HausScene[];
  scripts: HausScript[];
  automations: HausAutomationRule[];
  apps: Array<[string, InstalledAppEntry]>;
}

export function normalizeScene(scene: HausScene): HausScene {
  const members = (scene.members ?? []).map((member) => {
    const raw = member as object as Record<string, unknown>;
    if (raw.targetState && typeof raw.targetState === 'object') {
      return member;
    }
    const capability = typeof raw.capability === 'string' ? raw.capability : 'state';
    const params = raw.parameters as Record<string, unknown> | undefined;
    const value = params?.value ?? raw.value ?? raw.command;
    return {
      endpointId: String(raw.endpointId ?? ''),
      targetState: { [capability]: value },
    };
  });
  return { ...scene, members };
}

export function normalizeSteps(steps: readonly unknown[]): HausScript['steps'] {
  return (steps ?? []).map((step) => {
    const raw = step as Record<string, unknown>;
    if (raw.type === 'device_command') {
      return {
        type: 'action',
        action: {
          kind: 'device_command',
          payload: {
            endpointId: String(raw.endpointId ?? ''),
            capability: String(raw.capability ?? ''),
            command: String(raw.command ?? 'set'),
            parameters:
              raw.parameters && typeof raw.parameters === 'object'
                ? (raw.parameters as Record<string, unknown>)
                : undefined,
          },
        },
      };
    }
    return step as HausScript['steps'][number];
  });
}

export class StandaloneHomePersistence {
  constructor(private readonly transactions?: Transactions) {}

  async load(): Promise<PersistedHomeSnapshot> {
    const empty: PersistedHomeSnapshot = {
      devices: [],
      endpointStates: [],
      scenes: [],
      scripts: [],
      automations: [],
      apps: [],
    };
    if (!this.transactions) return empty;

    return this.transactions.run(async (manager) => {
      const rows = await manager.find(StandaloneHomeEntryEntity, {
        order: { updatedAt: 'ASC' },
      });
      for (const row of rows) {
        this.decodeRow(row, empty);
      }
      return empty;
    });
  }

  save(kind: StandaloneEntryKind, entryId: string, payload: unknown): Promise<void> {
    if (!this.transactions || !entryId) return Promise.resolve();
    const row: StandaloneHomeEntryRow = {
      kind,
      entryId,
      value: JSON.stringify(payload),
      updatedAt: Date.now(),
    };
    return this.transactions.run(async (manager) => {
      await manager.upsert(StandaloneHomeEntryEntity, row, ['kind', 'entryId']);
    });
  }

  remove(kind: StandaloneEntryKind, entryId: string): Promise<void> {
    if (!this.transactions || !entryId) return Promise.resolve();
    return this.transactions.run(async (manager) => {
      await manager.delete(StandaloneHomeEntryEntity, { kind, entryId });
    });
  }

  async listByKind<T = unknown>(kind: StandaloneEntryKind): Promise<Array<{ entryId: string; value: T }>> {
    if (!this.transactions) return [];
    return this.transactions.run(async (manager) => {
      const rows = await manager.find(StandaloneHomeEntryEntity, {
        where: { kind },
        order: { updatedAt: 'ASC' },
      });
      const out: Array<{ entryId: string; value: T }> = [];
      for (const row of rows) {
        try {
          out.push({ entryId: row.entryId, value: JSON.parse(row.value) as T });
        } catch {
          // ignore malformed entry
        }
      }
      return out;
    });
  }

  private decodeRow(row: StandaloneHomeEntryRow, out: PersistedHomeSnapshot): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.value) as unknown;
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== 'object') return;

    switch (row.kind) {
      case 'device':
        out.devices.push(parsed as HausDevice);
        break;
      case 'endpoint_state':
        out.endpointStates.push([row.entryId, parsed as Record<string, unknown>]);
        break;
      case 'scene':
        out.scenes.push(parsed as HausScene);
        break;
      case 'script':
        out.scripts.push(parsed as HausScript);
        break;
      case 'automation':
        out.automations.push(parsed as HausAutomationRule);
        break;
      case 'app':
        out.apps.push([row.entryId, parsed as InstalledAppEntry]);
        break;
      default:
        break;
    }
  }
}

export async function applyHomeSnapshot(
  snapshot: PersistedHomeSnapshot,
  target: {
    devices: { registerDevice: (d: HausDevice) => HausDevice };
    roomCoordinator: {
      registerDevice: (d: HausDevice) => Promise<unknown>;
      putScene: (s: HausScene) => Promise<unknown>;
      putScript: (s: HausScript) => Promise<unknown>;
      putAutomation: (a: HausAutomationRule) => Promise<unknown>;
    };
    endpointStates: Map<string, Record<string, unknown>>;
    scenes: Map<string, HausScene>;
    scripts: Map<string, HausScript>;
    automations: Map<string, HausAutomationRule>;
    automationEngine: { updateRule: (r: HausAutomationRule) => void };
    installedApps: Map<string, InstalledAppEntry>;
  },
): Promise<void> {
  for (const dev of snapshot.devices) {
    const normalized = target.devices.registerDevice(dev);
    await target.roomCoordinator.registerDevice(normalized);
  }
  for (const [epId, state] of snapshot.endpointStates) {
    target.endpointStates.set(epId, state);
  }
  for (const scene of snapshot.scenes) {
    const normalized = normalizeScene(scene);
    target.scenes.set(normalized.id, normalized);
    await target.roomCoordinator.putScene(normalized);
  }
  for (const script of snapshot.scripts) {
    target.scripts.set(script.id, script);
    await target.roomCoordinator.putScript(script);
  }
  for (const rule of snapshot.automations) {
    target.automations.set(rule.id, rule);
    await target.roomCoordinator.putAutomation(rule);
    target.automationEngine.updateRule(rule);
  }
  for (const [appId, entry] of snapshot.apps) {
    target.installedApps.set(appId, entry);
  }
}
