/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  redactSetupCode,
  wipeBuffer,
  wipeWifiCredentials,
  type Advertisement,
  type CommissioningAdapter,
  type CommissioningEvent,
  type CommissioningEventType,
  type CommissioningProtocol,
  type CommissioningResult,
  type CommissioningState,
  type CommissioningTransaction,
  type HausDevice,
  type ParsedSetupCode,
  type RequiredCredentialsPrompt,
  type WifiCredentials,
} from '@haus/core';
import { computeHomeKitSetupHash } from '@haus/homekit';
import type { HomeKitControllerService } from '../homekit/service.js';
import type { ManualAddressInput } from './handover.js';
import type { RadioAgentRegistry } from './radio.js';

export interface CommissioningMutableSession {
  homeId: string;
  code: string;
  tx: {
    commissioningId: string;
    state: CommissioningState;
    updatedAt: number;
    error?: string;
    selectedCandidate?: Advertisement;
    candidates?: readonly Advertisement[];
    pairedDevices?: readonly HausDevice[];
    requiresCredentials?: RequiredCredentialsPrompt;
  };
  events: CommissioningEvent[];
  wifi?: WifiCredentials;
  threadDataset?: Uint8Array;
  abortController: AbortController;
  running: boolean;
}

export function wipeSessionCredentials(session: CommissioningMutableSession): void {
  if (session.wifi) {
    wipeWifiCredentials(session.wifi);
    session.wifi = undefined;
  }
  if (session.threadDataset) {
    wipeBuffer(session.threadDataset);
    session.threadDataset = undefined;
  }
}

export function isTerminalCommissioningState(state: CommissioningState): boolean {
  return state === 'DONE' || state === 'FAILED' || state === 'CANCELLED';
}

export function updateCommissioningSession<T extends { updatedAt: number }>(
  session: { tx: T },
  patch: Partial<T>,
): void {
  session.tx = { ...session.tx, ...patch, updatedAt: Date.now() };
}

export function emitCommissioningEvent<T extends { state: CommissioningState; updatedAt: number }>(
  session: { tx: T; events: CommissioningEvent[] },
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
  if (!isTerminalCommissioningState(session.tx.state)) {
    session.tx = { ...session.tx, state, updatedAt: Date.now() };
  }
}

export function buildCandidateAdvertisement(
  candidate: {
    readonly id: string;
    readonly name: string;
    readonly protocol: string;
    readonly addresses: readonly string[];
    readonly port?: number;
    readonly details: Readonly<Record<string, unknown>>;
  },
  fallbackProtocol: CommissioningProtocol,
): Advertisement {
  return {
    agentId: 'hub',
    transport: 'lan',
    protocol: (candidate.protocol as CommissioningProtocol) ?? fallbackProtocol ?? 'generic',
    identifier: candidate.id,
    name: candidate.name,
    address: candidate.addresses[0],
    port: candidate.port,
    discriminator:
      typeof candidate.details?.discriminator === 'number'
        ? candidate.details.discriminator
        : undefined,
  };
}

export interface CommissioningSessionRecord extends CommissioningMutableSession {
  hubId: string;
  userId: string;
  deadlineTimestamp: number;
  tx: CommissioningTransaction;
}

export function createCommissioningSession(params: {
  id: string;
  code: string;
  homeId: string;
  hubId: string;
  userId: string;
  deadlineTimestamp: number;
  now: number;
  parsed: ParsedSetupCode;
}): CommissioningSessionRecord {
  const session: CommissioningSessionRecord = {
    code: params.code,
    homeId: params.homeId,
    hubId: params.hubId,
    userId: params.userId,
    deadlineTimestamp: params.deadlineTimestamp,
    abortController: new AbortController(),
    events: [],
    running: false,
    tx: {
      commissioningId: params.id,
      homeId: params.homeId,
      hubId: params.hubId,
      userId: params.userId,
      createdAt: params.now,
      updatedAt: params.now,
      deadlineTimestamp: params.deadlineTimestamp,
      state: 'PARSE_CODE',
      parsedCode: redactSetupCode(params.parsed),
      candidates: [],
      events: [],
    },
  };
  emitCommissioningEvent(session, 'commission.create', 'PARSE_CODE', 'Commissioning created');
  emitCommissioningEvent(
    session,
    'commission.code.parsed',
    'PARSE_CODE',
    `Parsed ${params.parsed.kind}`,
  );
  return session;
}

export function applyManualAddressToSession(
  session: CommissioningSessionRecord,
  input: ManualAddressInput,
): void {
  const candidate = buildManualAdvertisement(
    input.address,
    input.port,
    session.tx.parsedCode.protocol,
  );
  updateCommissioningSession(session, { selectedCandidate: candidate, candidates: [candidate] });
  emitCommissioningEvent(
    session,
    'device.ip.discovered',
    'WAIT_FOR_IP',
    `Manual IP configured: ${input.address}`,
    {
      address: input.address,
      port: input.port,
      manualFallback: true,
    },
  );
}

export function applyCandidateToSession(
  session: CommissioningSessionRecord,
  candidate: Advertisement,
): void {
  updateCommissioningSession(session, { selectedCandidate: candidate });
  emitCommissioningEvent(
    session,
    'commission.candidate.selected',
    'SELECT_CANDIDATE',
    `Selected ${candidate.name}`,
    { candidateId: candidate.identifier },
  );
}

export function buildManualAdvertisement(
  address: string,
  port: number | undefined,
  protocol: CommissioningProtocol,
): Advertisement {
  return {
    agentId: 'manual',
    transport: 'lan',
    protocol,
    identifier: `manual:${address}:${port ?? 80}`,
    name: `Manual Device (${address})`,
    address,
    port,
  };
}

export function snapshotCommissioningSession<T extends { events: readonly CommissioningEvent[] }>(
  session: { tx: T; events: CommissioningEvent[] },
  sinceSeq?: number,
): T {
  const events =
    sinceSeq !== undefined ? session.events.filter((e) => e.seq > sinceSeq) : [...session.events];
  return { ...session.tx, events };
}

export async function runCommissioningSession(
  runner: CommissioningRunner,
  session: CommissioningMutableSession,
  parsed: ParsedSetupCode,
  resumed: boolean,
  onFail: (error: string) => void,
): Promise<void> {
  const ctx: CommissioningSessionContext = {
    commissioningId: session.tx.commissioningId,
    homeId: session.homeId,
    code: session.code,
    abortController: session.abortController,
    wifi: session.wifi,
    threadDataset: session.threadDataset,
    selectedCandidate: session.tx.selectedCandidate,
    running: session.running,
    emit: (type, state, msg, detail) => emitCommissioningEvent(session, type, state, msg, detail),
    update: (patch) => updateCommissioningSession(session, patch),
    fail: onFail,
  };
  await runner.run(ctx, parsed, resumed);
  session.wifi = ctx.wifi;
  session.threadDataset = ctx.threadDataset;
  session.running = ctx.running;
}

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
