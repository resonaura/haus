/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  wipeBuffer,
  wipeWifiCredentials,
  type Advertisement,
  type CommissioningAdapter,
  type CommissioningEventType,
  type CommissioningResult,
  type CommissioningState,
  type HausDevice,
  type ParsedSetupCode,
  type RequiredCredentialsPrompt,
  type WifiCredentials,
} from '@haus/core';
import { computeHomeKitSetupHash } from '@haus/homekit';
import type { HomeKitControllerService } from '../homekit/service.js';
import type { RadioAgentRegistry } from './radio.js';

export interface CommissioningSessionContext {
  readonly commissioningId: string;
  readonly homeId: string;
  readonly code: string;
  readonly abortController: AbortController;
  wifi?: WifiCredentials;
  threadDataset?: Uint8Array;
  selectedCandidate?: Advertisement;
  running: boolean;
  emit(
    type: CommissioningEventType,
    state: CommissioningState,
    message: string,
    detail?: Record<string, unknown>,
  ): void;
  update(patch: {
    state?: CommissioningState;
    pairedDevices?: readonly HausDevice[];
    requiresCredentials?: RequiredCredentialsPrompt;
    selectedCandidate?: Advertisement;
    candidates?: readonly Advertisement[];
  }): void;
  fail(error: string): void;
}

export class CommissioningRunner {
  constructor(
    private readonly adapters: readonly CommissioningAdapter[],
    private readonly homekit: HomeKitControllerService,
    private readonly radios: RadioAgentRegistry,
  ) {}

  public async run(
    session: CommissioningSessionContext,
    parsed: ParsedSetupCode,
    resumed = false,
  ): Promise<void> {
    session.running = true;
    try {
      const adapter = this.adapters.find((a) => a.canHandle(parsed));
      if (!adapter) {
        session.fail('no_adapter_for_code');
        return;
      }

      let candidate: Advertisement | undefined;
      if (parsed.protocol === 'homekit' && !resumed) {
        session.emit('discovery.lan.started', 'LAN_DISCOVERY', 'Searching _hap._tcp');
        candidate = await this.findHomeKitCandidate(session, parsed);
      }

      const result: CommissioningResult = await adapter.commission({
        commissioningId: session.commissioningId,
        homeId: session.homeId,
        parsedCode: parsed,
        candidate: candidate ?? session.selectedCandidate,
        wifiCredentials: session.wifi,
        threadDataset: session.threadDataset,
        abortSignal: session.abortController.signal,
        emit: (type, state, message, detail) => session.emit(type, state, message, detail),
      });

      if (session.abortController.signal.aborted) {
        return;
      }

      if (result.status === 'completed') {
        this.radios.revokeAllLeasesForSession(session.commissioningId);
        session.update({ state: 'DONE', pairedDevices: result.devices });
        session.emit('commission.completed', 'DONE', 'Commissioning completed');
      } else if (result.status === 'credentials_required') {
        session.update({
          state: 'OBTAIN_NETWORK_CREDENTIALS',
          requiresCredentials: result.requiresCredentials,
        });
        session.emit(
          'network.credentials.required',
          'OBTAIN_NETWORK_CREDENTIALS',
          'Wi-Fi or Thread credentials required',
        );
      } else {
        session.fail(result.error ?? 'commissioning_failed');
      }
    } catch (err: unknown) {
      if (session.abortController.signal.aborted) return;
      session.fail(err instanceof Error ? err.message : 'commissioning_failed');
    } finally {
      if (session.wifi) {
        wipeWifiCredentials(session.wifi);
        session.wifi = undefined;
      }
      if (session.threadDataset) {
        wipeBuffer(session.threadDataset);
        session.threadDataset = undefined;
      }
      session.running = false;
    }
  }

  public async findHomeKitCandidate(
    session: CommissioningSessionContext,
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
      session.emit('device.candidate', 'SELECT_CANDIDATE', `Candidate ${d.name}`, {
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
    session.update({ selectedCandidate: candidate, candidates: [candidate] });
    session.emit('device.identified', 'SELECT_CANDIDATE', `Selected ${pick.name}`);
    return candidate;
  }
}
