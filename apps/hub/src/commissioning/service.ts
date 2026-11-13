/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  BUILTIN_DNS_SD_RULES,
  DiscoveryRegistry,
  IntegrationFlowEngine,
  parseSetupCode,
  redactSetupCode,
  redactThreadDataset,
  redactWifiCredentials,
  wipeBuffer,
  wipeWifiCredentials,
  type Advertisement,
  type CommissioningAdapter,
  type CommissioningEvent,
  type CommissioningEventType,
  type CommissioningProtocol,
  type CommissioningState,
  type CommissioningTransaction,
  type DiscoveredCandidate,
  type DiscoveryAdvertisementInput,
  type DiscoveryFilter,
  type DiscoveryMatcherRule,
  type FlowInitOptions,
  type FlowSubmissionOptions,
  type IntegrationFlowStep,
  type ParsedSetupCode,
  type WifiCredentials,
} from '@haus/core';
import { HomeKitControllerService } from '../homekit/service.js';
import { MatterService } from '../matter/service.js';
import { DynamicCatalogService } from '@haus/ha';
import { HomeKitIpAdapter, MatterAdapter } from './adapters.js';
import { HubNetworkCredentialService } from './credentials.service.js';
import { HubIntegrationEntryService } from './entries.js';
import {
  mergeDiscoveryTxtDetails,
  parseNetworkCredentialsInput,
  type NetworkCredentialsInput,
} from './entry-helpers.js';
import {
  HandoverCriteria,
  HandoverResult,
  IpHandoverCoordinator,
  ManualAddressInput,
} from './handover.js';
import { ImprovBleAdapter, ImprovSerialAdapter } from './improv.js';
import { RadioAgentRegistry } from './radio.js';
import { CommissioningRunner, type CommissioningSessionContext } from './runner.js';

export interface CreateCommissioningOptions {
  readonly code: string;
  readonly homeId?: string;
  readonly hubId?: string;
  readonly userId?: string;
  readonly deadlineMs?: number;
  readonly contextProtocol?: CommissioningProtocol;
}

export type CommissioningCredentialsInput = NetworkCredentialsInput;

interface Session {
  code: string;
  homeId: string;
  hubId: string;
  userId: string;
  deadlineTimestamp: number;
  abortController: AbortController;
  tx: CommissioningTransaction;
  events: CommissioningEvent[];
  wifi?: WifiCredentials;
  threadDataset?: Uint8Array;
  running: boolean;
}

@Injectable()
export class CommissioningService {
  private readonly logger = new Logger(CommissioningService.name);
  private readonly sessions = new Map<string, Session>();
  public readonly adapters: CommissioningAdapter[] = [];

  public readonly radios = new RadioAgentRegistry();
  public readonly discovery = new DiscoveryRegistry();
  public readonly catalog = new DynamicCatalogService();
  public readonly flows = new IntegrationFlowEngine(this.discovery, {
    hasDomain: (d) => Boolean(this.catalog.getCatalog().getManifest(d)),
    getManifest: (d) => this.catalog.getCatalog().getManifest(d),
    getAllDomains: () => this.catalog.getCatalog().getAllDomains(),
  });
  public readonly handover = new IpHandoverCoordinator(this.discovery);
  private readonly runner: CommissioningRunner;
  private matcherRules: DiscoveryMatcherRule[] = [];

  constructor(
    @Inject(HomeKitControllerService) private readonly homekit: HomeKitControllerService,
    @Optional() @Inject(MatterService) private readonly matter?: MatterService,
    @Optional()
    @Inject(HubNetworkCredentialService)
    public readonly credentialsService?: HubNetworkCredentialService,
    @Optional()
    @Inject(HubIntegrationEntryService)
    private readonly entriesService?: HubIntegrationEntryService,
  ) {
    this.adapters.push(new HomeKitIpAdapter(homekit, this.radios));
    this.adapters.push(new ImprovBleAdapter(this.radios, this.handover));
    this.adapters.push(new ImprovSerialAdapter(undefined, this.handover));
    if (matter?.isConfigured) {
      this.adapters.push(new MatterAdapter(matter, this.radios, this.handover));
    }
    this.runner = new CommissioningRunner(this.adapters, this.homekit, this.radios);
    this.loadMatcherRules(BUILTIN_DNS_SD_RULES);
    this.entriesService?.registerDynamicDomains(this.flows);
  }

  create(input: string | CreateCommissioningOptions): CommissioningTransaction {
    const opts: CreateCommissioningOptions = typeof input === 'string' ? { code: input } : input;
    const rawCode = opts.code;
    const homeId = opts.homeId ?? 'home-default';
    const hubId = opts.hubId ?? 'hub-local';
    const userId = opts.userId ?? 'local-user';
    const deadlineMs = opts.deadlineMs ?? 120_000;
    const now = Date.now();
    const deadlineTimestamp = now + deadlineMs;

    for (const active of this.sessions.values()) {
      if (
        active.homeId === homeId &&
        active.code === rawCode &&
        !this.isTerminal(active.tx.state)
      ) {
        if (Date.now() > active.deadlineTimestamp) {
          this.fail(active, 'deadline_exceeded');
        } else {
          return this.snapshot(active);
        }
      }
    }

    const parsed = parseSetupCode(rawCode, { contextProtocol: opts.contextProtocol });
    const id = randomUUID();
    const abortController = new AbortController();

    const session: Session = {
      code: rawCode,
      homeId,
      hubId,
      userId,
      deadlineTimestamp,
      abortController,
      events: [],
      running: false,
      tx: {
        commissioningId: id,
        homeId,
        hubId,
        userId,
        createdAt: now,
        updatedAt: now,
        deadlineTimestamp,
        state: 'PARSE_CODE',
        parsedCode: redactSetupCode(parsed),
        candidates: [],
        events: [],
      },
    };
    this.sessions.set(id, session);
    this.emit(session, 'commission.create', 'PARSE_CODE', 'Commissioning created');
    this.emit(session, 'commission.code.parsed', 'PARSE_CODE', `Parsed ${parsed.kind}`);
    void this.executeRun(session, parsed);
    return this.snapshot(session);
  }

  get(
    id: string,
    auth?: { homeId?: string; sinceSeq?: number },
  ): CommissioningTransaction | undefined {
    const s = this.sessions.get(id);
    if (!s) return undefined;
    if (auth?.homeId && s.homeId !== auth.homeId) throw new Error('wrong_home');
    if (!this.isTerminal(s.tx.state) && Date.now() > s.deadlineTimestamp) {
      this.fail(s, 'deadline_exceeded');
    }
    return this.snapshot(s, auth?.sinceSeq);
  }

  resume(
    id: string,
    auth: { homeId: string; activeOwner?: string },
  ): CommissioningTransaction | undefined {
    const s = this.sessions.get(id);
    if (!s) return undefined;
    if (s.homeId !== auth.homeId) throw new Error('wrong_home');
    if (!this.isTerminal(s.tx.state) && Date.now() > s.deadlineTimestamp) {
      this.fail(s, 'deadline_exceeded');
      return this.snapshot(s);
    }
    if (auth.activeOwner) this.update(s, { activeOwner: auth.activeOwner });
    this.emit(s, 'commission.resumed', s.tx.state, 'Client reconnected to transaction', {
      activeOwner: auth.activeOwner,
    });
    return this.snapshot(s);
  }

  cancel(id: string, auth: { homeId: string }): boolean {
    const s = this.sessions.get(id);
    if (!s) return false;
    if (s.homeId !== auth.homeId) throw new Error('wrong_home');
    if (this.isTerminal(s.tx.state)) return false;
    s.abortController.abort();
    this.handover.cancel(id);
    this.radios.revokeAllLeasesForSession(id);
    this.update(s, { state: 'CANCELLED', error: 'cancelled_by_user' });
    this.emit(s, 'commission.cancelled', 'CANCELLED', 'Commissioning cancelled by user');
    if (s.wifi) {
      wipeWifiCredentials(s.wifi);
      s.wifi = undefined;
    }
    if (s.threadDataset) {
      wipeBuffer(s.threadDataset);
      s.threadDataset = undefined;
    }
    return true;
  }

  provideManualAddress(
    id: string,
    input: ManualAddressInput,
    auth?: { homeId?: string },
  ): CommissioningTransaction | undefined {
    const s = this.sessions.get(id);
    if (!s) return undefined;
    if (auth?.homeId && s.homeId !== auth.homeId) throw new Error('wrong_home');
    this.handover.resolveManualAddress(id, input);
    const candidate: Advertisement = {
      agentId: 'manual',
      transport: 'lan',
      protocol: s.tx.parsedCode.protocol,
      identifier: `manual:${input.address}:${input.port ?? 80}`,
      name: `Manual Device (${input.address})`,
      address: input.address,
      port: input.port,
    };
    this.update(s, { selectedCandidate: candidate, candidates: [candidate] });
    this.emit(s, 'device.ip.discovered', 'WAIT_FOR_IP', `Manual IP configured: ${input.address}`, {
      address: input.address,
      port: input.port,
      manualFallback: true,
    });
    if (
      !s.running &&
      (s.tx.state === 'WAIT_FOR_IP' ||
        s.tx.state === 'SELECT_CANDIDATE' ||
        s.tx.state === 'FAILED' ||
        s.tx.state === 'OBTAIN_NETWORK_CREDENTIALS')
    ) {
      void this.executeRun(s, parseSetupCode(s.code), true);
    }
    return this.snapshot(s);
  }

  async waitForIpReappearance(id: string, criteria: HandoverCriteria): Promise<HandoverResult> {
    const s = this.sessions.get(id);
    if (!s) throw new Error('commissioning_not_found');
    return this.handover.waitForIp(id, criteria, { signal: s.abortController.signal });
  }

  pruneExpiredDiscoveries(now = Date.now()): number {
    return this.discovery.pruneExpired(now);
  }

  selectCandidate(
    id: string,
    candidateId: string,
    auth: { homeId: string },
  ): CommissioningTransaction | undefined {
    const s = this.sessions.get(id);
    if (!s) return undefined;
    if (s.homeId !== auth.homeId) throw new Error('wrong_home');
    let candidate = s.tx.candidates.find(
      (c) => c.identifier === candidateId || c.agentId === candidateId,
    );
    if (!candidate) {
      const disc = this.discovery.getCandidate(candidateId);
      if (disc) {
        candidate = {
          agentId: 'hub',
          transport: 'lan',
          protocol:
            (disc.protocol as CommissioningProtocol) ?? s.tx.parsedCode?.protocol ?? 'generic',
          identifier: disc.id,
          name: disc.name,
          address: disc.addresses[0],
          port: disc.port,
          discriminator:
            typeof disc.details?.discriminator === 'number'
              ? disc.details.discriminator
              : undefined,
        };
      }
    }
    if (!candidate) throw new Error('candidate_not_found');
    this.update(s, { selectedCandidate: candidate });
    this.emit(
      s,
      'commission.candidate.selected',
      'SELECT_CANDIDATE',
      `Selected ${candidate.name}`,
      { candidateId: candidate.identifier },
    );
    if (!s.running) void this.executeRun(s, parseSetupCode(s.code), true);
    return this.snapshot(s);
  }

  async provideCredentials(
    id: string,
    input: WifiCredentials | CommissioningCredentialsInput,
    auth?: { homeId?: string },
  ): Promise<CommissioningTransaction | undefined> {
    const s = this.sessions.get(id);
    if (!s) return undefined;
    if (auth?.homeId && s.homeId !== auth.homeId) throw new Error('wrong_home');
    if (s.tx.state !== 'OBTAIN_NETWORK_CREDENTIALS' || s.running) return this.snapshot(s);

    const { wifi, threadDataset, saveForReuse } = parseNetworkCredentialsInput(input);

    if (saveForReuse && this.credentialsService) {
      if (wifi) {
        await this.credentialsService.saveWifi(wifi.ssid, wifi.password, true);
      }
      if (threadDataset) {
        await this.credentialsService.saveThread(threadDataset, {
          source: 'manual',
          userApproved: true,
        });
      }
    }

    s.wifi = wifi;
    s.threadDataset = threadDataset;
    this.emit(
      s,
      'network.credentials.provided',
      'NETWORK_PROVISION',
      'Network credentials provided',
      {
        wifi: redactWifiCredentials(wifi),
        thread: redactThreadDataset(threadDataset),
      },
    );

    void this.executeRun(s, parseSetupCode(s.code), true);
    return this.snapshot(s);
  }

  loadMatcherRules(rules: readonly DiscoveryMatcherRule[]): void {
    this.matcherRules = [...rules];
  }

  ingestDiscovery(input: DiscoveryAdvertisementInput): DiscoveredCandidate {
    const details = mergeDiscoveryTxtDetails(input.protocol, input.details);
    return this.discovery.ingest({ ...input, details }, this.matcherRules);
  }

  listDiscoveries(filter?: DiscoveryFilter): readonly DiscoveredCandidate[] {
    return this.discovery.listCandidates(filter);
  }
  getDiscovery(id: string): DiscoveredCandidate | undefined {
    return this.discovery.getCandidate(id);
  }
  ignoreDiscovery(id: string): boolean {
    return this.discovery.ignore(id);
  }
  unignoreDiscovery(id: string): boolean {
    return this.discovery.unignore(id);
  }
  markDiscoveryConfigured(id: string, configured = true): boolean {
    return this.discovery.markConfigured(id, configured);
  }
  async startFlow(options: FlowInitOptions): Promise<IntegrationFlowStep> {
    if (this.entriesService) {
      return this.entriesService.startFlowWithPersistence(this.flows, options, (d) =>
        this.catalog.getCatalog().getManifest(d),
      );
    }
    return this.flows.startFlow(options);
  }
  getFlow(
    flowId: string,
    auth: { homeId: string; userId?: string },
  ): IntegrationFlowStep | undefined {
    return this.flows.getFlow(flowId, auth);
  }
  async submitFlowStep(submission: FlowSubmissionOptions): Promise<IntegrationFlowStep> {
    if (this.entriesService) {
      return this.entriesService.submitFlowWithPersistence(this.flows, submission, (d) =>
        this.catalog.getCatalog().getManifest(d),
      );
    }
    return this.flows.submitStep(submission);
  }
  cancelFlow(flowId: string, auth: { homeId: string; userId?: string }): boolean {
    return this.flows.cancelFlow(flowId, auth);
  }
  listActiveFlows(homeId: string): readonly IntegrationFlowStep[] {
    return this.flows.listActiveFlows(homeId);
  }

  private async executeRun(
    session: Session,
    parsed: ParsedSetupCode,
    resumed = false,
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
      emit: (type, state, msg, detail) => this.emit(session, type, state, msg, detail),
      update: (patch) => this.update(session, patch),
      fail: (err) => this.fail(session, err),
    };
    await this.runner.run(ctx, parsed, resumed);
    session.wifi = ctx.wifi;
    session.threadDataset = ctx.threadDataset;
    session.running = ctx.running;
  }

  private isTerminal(state: CommissioningState): boolean {
    return state === 'DONE' || state === 'FAILED' || state === 'CANCELLED';
  }

  private fail(session: Session, error: string): void {
    if (session.tx.state === 'CANCELLED') return;
    this.radios.revokeAllLeasesForSession(session.tx.commissioningId);
    this.logger.warn(`Commissioning ${session.tx.commissioningId} failed: ${error}`);
    this.update(session, { state: 'FAILED', error });
    this.emit(session, 'commission.failed', 'FAILED', error);
    if (session.wifi) {
      wipeWifiCredentials(session.wifi);
      session.wifi = undefined;
    }
    if (session.threadDataset) {
      wipeBuffer(session.threadDataset);
      session.threadDataset = undefined;
    }
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
    if (!this.isTerminal(session.tx.state)) {
      this.update(session, { state });
    }
  }

  private snapshot(session: Session, sinceSeq?: number): CommissioningTransaction {
    const events =
      sinceSeq !== undefined ? session.events.filter((e) => e.seq > sinceSeq) : [...session.events];
    return { ...session.tx, events };
  }
}
