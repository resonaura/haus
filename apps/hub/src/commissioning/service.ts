/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  parseSetupCode,
  type Advertisement,
  type CommissioningAdapter,
  type CommissioningEvent,
  type CommissioningEventType,
  type CommissioningResult,
  type CommissioningState,
  type CommissioningTransaction,
  type ParsedSetupCode,
  type WifiCredentials,
} from '@haus/core';
import { computeHomeKitSetupHash } from '@haus/homekit';
import { HomeKitControllerService } from '../homekit/service.js';
import { MatterService } from '../matter/service.js';
import { HomeKitIpAdapter, MatterAdapter } from './adapters.js';
import { ImprovBleAdapter } from './improv.js';
import { RadioAgentRegistry } from './radio.js';

interface Session {
  code: string;
  tx: CommissioningTransaction;
  events: CommissioningEvent[];
  wifi?: WifiCredentials;
  running: boolean;
}

@Injectable()
export class CommissioningService {
  private readonly logger = new Logger(CommissioningService.name);
  private readonly sessions = new Map<string, Session>();
  private readonly adapters: CommissioningAdapter[] = [];

  public readonly radios = new RadioAgentRegistry();

  constructor(
    @Inject(HomeKitControllerService) private readonly homekit: HomeKitControllerService,
    @Optional() @Inject(MatterService) private readonly matter?: MatterService,
  ) {
    this.adapters.push(new HomeKitIpAdapter(homekit));
    this.adapters.push(new ImprovBleAdapter(this.radios));
    if (matter?.isConfigured) this.adapters.push(new MatterAdapter(matter));
  }

  create(rawCode: string): CommissioningTransaction {
    const parsed = parseSetupCode(rawCode);
    const id = randomUUID();
    const now = Date.now();
    const session: Session = {
      code: rawCode,
      events: [],
      running: false,
      tx: {
        commissioningId: id,
        createdAt: now,
        updatedAt: now,
        state: 'PARSE_CODE',
        parsedCode: redact(parsed),
        candidates: [],
        events: [],
      },
    };
    this.sessions.set(id, session);
    this.emit(session, 'commission.create', 'PARSE_CODE', 'Commissioning created');
    this.emit(session, 'commission.code.parsed', 'PARSE_CODE', `Parsed ${parsed.kind}`);
    void this.run(session, parsed);
    return this.snapshot(session);
  }

  get(id: string): CommissioningTransaction | undefined {
    const s = this.sessions.get(id);
    return s ? this.snapshot(s) : undefined;
  }

  provideCredentials(id: string, wifi: WifiCredentials): CommissioningTransaction | undefined {
    const s = this.sessions.get(id);
    if (!s) return undefined;
    if (s.tx.state !== 'OBTAIN_NETWORK_CREDENTIALS' || s.running) return this.snapshot(s);
    s.wifi = wifi;
    void this.run(s, parseSetupCode(s.code), true);
    return this.snapshot(s);
  }

  private async run(session: Session, parsed: ParsedSetupCode, resumed = false): Promise<void> {
    session.running = true;
    try {
      const adapter = this.adapters.find((a) => a.canHandle(parsed));
      if (!adapter) return this.fail(session, 'no_adapter_for_code');

      let candidate: Advertisement | undefined;
      if (parsed.protocol === 'homekit' && !resumed) {
        this.emit(session, 'discovery.lan.started', 'LAN_DISCOVERY', 'Searching _hap._tcp');
        candidate = await this.findHomeKitCandidate(session, parsed);
      }

      const result: CommissioningResult = await adapter.commission({
        commissioningId: session.tx.commissioningId,
        parsedCode: parsed,
        candidate: candidate ?? session.tx.selectedCandidate,
        wifiCredentials: session.wifi,
        emit: (type, state, message, detail) => this.emit(session, type, state, message, detail),
      });
      session.wifi = undefined;

      if (result.status === 'completed') {
        this.update(session, { state: 'DONE', pairedDevices: result.devices });
        this.emit(session, 'commission.completed', 'DONE', 'Commissioning completed');
      } else if (result.status === 'credentials_required') {
        this.update(session, {
          state: 'OBTAIN_NETWORK_CREDENTIALS',
          requiresCredentials: result.requiresCredentials,
        });
        this.emit(
          session,
          'network.credentials.required',
          'OBTAIN_NETWORK_CREDENTIALS',
          'Wi-Fi credentials required',
        );
      } else {
        this.fail(session, result.error ?? 'commissioning_failed');
      }
    } catch (err: unknown) {
      this.fail(session, err instanceof Error ? err.message : 'commissioning_failed');
    } finally {
      session.running = false;
    }
  }

  private async findHomeKitCandidate(
    session: Session,
    parsed: ParsedSetupCode,
  ): Promise<Advertisement | undefined> {
    const found = await this.homekit.discoverAccessories(3000);
    const unpaired = found.filter((d) => !d.paired);
    const wantId = parsed.homekit?.setupId;
    const matches = wantId
      ? unpaired.filter((d) => d.setupHash && computeHomeKitSetupHash(wantId, d.id) === d.setupHash)
      : unpaired;
    const pick = matches.length === 1 ? matches[0] : undefined;
    for (const d of unpaired) {
      this.emit(session, 'device.candidate', 'SELECT_CANDIDATE', `Candidate ${d.name}`, {
        id: d.id,
      });
    }
    if (!pick) return undefined;
    const candidate: Advertisement = {
      agentId: 'hub',
      transport: 'lan',
      protocol: 'homekit',
      identifier: pick.id,
      name: pick.name,
      address: pick.address,
      port: pick.port,
    };
    this.update(session, { selectedCandidate: candidate, candidates: [candidate] });
    this.emit(session, 'device.identified', 'SELECT_CANDIDATE', `Selected ${pick.name}`);
    return candidate;
  }

  private fail(session: Session, error: string): void {
    this.logger.warn(`Commissioning ${session.tx.commissioningId} failed: ${error}`);
    this.update(session, { state: 'FAILED', error });
    this.emit(session, 'commission.failed', 'FAILED', error);
  }

  private update(session: Session, patch: Partial<CommissioningTransaction>): void {
    session.tx = { ...session.tx, ...patch, updatedAt: Date.now() };
  }

  private emit(
    session: Session,
    type: CommissioningEventType,
    state: CommissioningState,
    message: string,
    detail?: Record<string, unknown>,
  ): void {
    session.events.push({
      seq: session.events.length + 1,
      timestamp: Date.now(),
      type,
      state,
      message,
      detail,
    });
    if (session.tx.state !== 'DONE' && session.tx.state !== 'FAILED') {
      this.update(session, { state });
    }
  }

  private snapshot(session: Session): CommissioningTransaction {
    return { ...session.tx, events: [...session.events] };
  }
}

/** Setup codes are secrets: never echo the raw code back to clients. */
function redact(parsed: ParsedSetupCode): ParsedSetupCode {
  return { kind: parsed.kind, raw: '', protocol: parsed.protocol };
}
