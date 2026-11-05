/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { encodeHomeKitSetupUri } from './setup-payload.js';
import { HomeKitCategory, type HomeKitTxtRecord } from './types.js';
import { guardHomeKitTxtRecord } from './mdns-guard.js';

export interface StandaloneAccessoryConfig {
  readonly id: string;
  readonly name: string;
  readonly category: HomeKitCategory;
  readonly pin: string; // "XXX-XX-XXX"
  readonly setupId: string; // 4 chars
  readonly username: string; // "XX:XX:XX:XX:XX:XX"
  readonly port?: number;
}

export class HAPStandalone {
  private readonly published = new Map<string, StandaloneAccessoryConfig>();
  private readonly running = new Set<string>();

  public register(config: StandaloneAccessoryConfig): string {
    this.published.set(config.id, config);
    return encodeHomeKitSetupUri({
      pin: config.pin,
      setupId: config.setupId,
      category: config.category,
    });
  }

  public getSetupUri(id: string): string | undefined {
    const config = this.published.get(id);
    if (!config) return undefined;
    return encodeHomeKitSetupUri({
      pin: config.pin,
      setupId: config.setupId,
      category: config.category,
    });
  }

  public getTxtRecord(id: string): HomeKitTxtRecord | undefined {
    const config = this.published.get(id);
    if (!config) return undefined;

    const raw: HomeKitTxtRecord = {
      md: config.name,
      pv: '1.1',
      id: config.username,
      'c#': 1,
      's#': 1,
      sf: 1,
      ff: 0,
      ci: config.category,
    };
    return guardHomeKitTxtRecord(raw);
  }

  public async start(id: string): Promise<boolean> {
    if (!this.published.has(id)) return false;
    this.running.add(id);
    return true;
  }

  public async stop(id: string): Promise<boolean> {
    return this.running.delete(id);
  }

  public isRunning(id: string): boolean {
    return this.running.has(id);
  }

  public listPublished(): StandaloneAccessoryConfig[] {
    return Array.from(this.published.values());
  }
}
