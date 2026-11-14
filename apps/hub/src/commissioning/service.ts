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
  redactThreadDataset,
  redactWifiCredentials,
  selectBestDiscoveryMatch,
  type CommissioningAdapter,
  type CommissioningProtocol,
  type CommissioningTransaction,
  type DiscoveredCandidate,
  type DiscoveryAdvertisementInput,
  type DiscoveryFilter,
  type DiscoveryMatcherRule,
  type FlowInitOptions,
  type FlowSubmissionOptions,
  type IntegrationFlowStep,
  type WifiCredentials,
} from '@haus/core';
import { STANDALONE_HOME_SERVICE, StandaloneHomeService } from '../home/home.service.js';
import { HomeKitControllerService } from '../homekit/service.js';
import { MatterService } from '../matter/service.js';
import { DynamicCatalogService, type HaIntegrationCatalog } from '@haus/ha';
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
import {
  loadIgnoredDiscoveries,
  reconcileConfiguredDiscoveries,
  removeIgnoredDiscovery,
  resolveCatalogCachePath,
  saveIgnoredDiscovery,
} from './lan/reconcile.js';
import { RadioAgentRegistry } from './radio.js';
import {
  CommissioningRunner,
  type CommissioningSessionRecord,
  applyCandidateToSession,
  applyManualAddressToSession,
  buildCandidateAdvertisement,
  createCommissioningSession,
  emitCommissioningEvent,
  isTerminalCommissioningState,
  runCommissioningSession,
  snapshotCommissioningSession,
  updateCommissioningSession,
  wipeSessionCredentials,
} from './runner.js';

export interface CreateCommissioningOptions {
  readonly code: string;
  readonly homeId?: string;
  readonly hubId?: string;
  readonly userId?: string;
  readonly deadlineMs?: number;
  readonly contextProtocol?: CommissioningProtocol;
}

export type CommissioningCredentialsInput = NetworkCredentialsInput;

type Session = CommissioningSessionRecord;

@Injectable()
export class CommissioningService {
  private readonly logger = new Logger(CommissioningService.name);
  private readonly sessions = new Map<string, Session>();
  public readonly adapters: CommissioningAdapter[] = [];

  public readonly radios = new RadioAgentRegistry();
  public readonly discovery = new DiscoveryRegistry();
  public readonly catalog = new DynamicCatalogService({
    cachePath: resolveCatalogCachePath(),
  });
  public readonly flows = new IntegrationFlowEngine(this.discovery, {
    hasDomain: (d) => Boolean(this.catalog.getCatalog().getManifest(d)),
    getManifest: (d) => this.catalog.getCatalog().getManifest(d),
    getAllDomains: () => this.catalog.getCatalog().getAllDomains(),
  });
  public readonly handover = new IpHandoverCoordinator(this.discovery);
  private readonly runner: CommissioningRunner;
  private matcherRules: DiscoveryMatcherRule[] = [];
  private persistedDiscoveryRestored = false;
  private haCatalogRefreshHook?: () => Promise<void>;
  private haDiscoveryIngestedHook?: (
    candidate: DiscoveredCandidate,
    input: DiscoveryAdvertisementInput,
  ) => void;

  constructor(
    @Inject(HomeKitControllerService) private readonly homekit: HomeKitControllerService,
    @Optional() @Inject(MatterService) private readonly matter?: MatterService,
    @Optional()
    @Inject(HubNetworkCredentialService)
    public readonly credentialsService?: HubNetworkCredentialService,
    @Optional()
    @Inject(HubIntegrationEntryService)
    private readonly entriesService?: HubIntegrationEntryService,
    @Optional()
    @Inject(STANDALONE_HOME_SERVICE)
    private readonly homeService?: StandaloneHomeService,
  ) {
    this.adapters.push(new HomeKitIpAdapter(homekit, this.radios));
    this.adapters.push(new ImprovBleAdapter(this.radios, this.handover));
    this.adapters.push(new ImprovSerialAdapter(undefined, this.handover));
    if (matter?.isConfigured) {
      this.adapters.push(new MatterAdapter(matter, this.radios, this.handover));
    }
    this.runner = new CommissioningRunner(this.adapters, this.homekit, this.radios);
    this.refreshMatcherRules();
    this.entriesService?.registerDynamicDomains(this.flows, (domain) => {
      const manifest = this.catalog.getCatalog().getManifest(domain);
      return Boolean(
        manifest?.config_flow ||
        manifest?.supported_by ||
        this.catalog.getTranslations().hasFlowHandler(domain),
      );
    });
  }

  setHaCatalogRefreshHook(hook: () => Promise<void>): void {
    this.haCatalogRefreshHook = hook;
  }

  setHaDiscoveryIngestedHook(
    hook: (candidate: DiscoveredCandidate, input: DiscoveryAdvertisementInput) => void,
  ): void {
    this.haDiscoveryIngestedHook = hook;
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
        !isTerminalCommissioningState(active.tx.state)
      ) {
        if (Date.now() > active.deadlineTimestamp) {
          this.fail(active, 'deadline_exceeded');
        } else {
          return snapshotCommissioningSession(active);
        }
      }
    }

    const parsed = parseSetupCode(rawCode, { contextProtocol: opts.contextProtocol });
    const id = randomUUID();
    const session = createCommissioningSession({
      id,
      code: rawCode,
      homeId,
      hubId,
      userId,
      deadlineTimestamp,
      now,
      parsed,
    });
    this.sessions.set(id, session);
    void runCommissioningSession(this.runner, session, parsed, false, (err) =>
      this.fail(session, err),
    );
    return snapshotCommissioningSession(session);
  }

  get(
    id: string,
    auth?: { homeId?: string; sinceSeq?: number },
  ): CommissioningTransaction | undefined {
    const s = this.sessions.get(id);
    if (!s) return undefined;
    if (auth?.homeId && s.homeId !== auth.homeId) throw new Error('wrong_home');
    if (!isTerminalCommissioningState(s.tx.state) && Date.now() > s.deadlineTimestamp) {
      this.fail(s, 'deadline_exceeded');
    }
    return snapshotCommissioningSession(s, auth?.sinceSeq);
  }

  resume(
    id: string,
    auth: { homeId: string; activeOwner?: string },
  ): CommissioningTransaction | undefined {
    const s = this.sessions.get(id);
    if (!s) return undefined;
    if (s.homeId !== auth.homeId) throw new Error('wrong_home');
    if (!isTerminalCommissioningState(s.tx.state) && Date.now() > s.deadlineTimestamp) {
      this.fail(s, 'deadline_exceeded');
      return snapshotCommissioningSession(s);
    }
    if (auth.activeOwner) updateCommissioningSession(s, { activeOwner: auth.activeOwner });
    emitCommissioningEvent(
      s,
      'commission.resumed',
      s.tx.state,
      'Client reconnected to transaction',
      {
        activeOwner: auth.activeOwner,
      },
    );
    return snapshotCommissioningSession(s);
  }

  cancel(id: string, auth: { homeId: string }): boolean {
    const s = this.sessions.get(id);
    if (!s) return false;
    if (s.homeId !== auth.homeId) throw new Error('wrong_home');
    if (isTerminalCommissioningState(s.tx.state)) return false;
    s.abortController.abort();
    this.handover.cancel(id);
    this.radios.revokeAllLeasesForSession(id);
    updateCommissioningSession(s, { state: 'CANCELLED', error: 'cancelled_by_user' });
    emitCommissioningEvent(
      s,
      'commission.cancelled',
      'CANCELLED',
      'Commissioning cancelled by user',
    );
    wipeSessionCredentials(s);
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
    applyManualAddressToSession(s, input);
    if (
      !s.running &&
      (s.tx.state === 'WAIT_FOR_IP' ||
        s.tx.state === 'SELECT_CANDIDATE' ||
        s.tx.state === 'FAILED' ||
        s.tx.state === 'OBTAIN_NETWORK_CREDENTIALS')
    ) {
      void runCommissioningSession(this.runner, s, parseSetupCode(s.code), true, (err) =>
        this.fail(s, err),
      );
    }
    return snapshotCommissioningSession(s);
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
      if (disc) candidate = buildCandidateAdvertisement(disc, s.tx.parsedCode?.protocol);
    }
    if (!candidate) throw new Error('candidate_not_found');
    applyCandidateToSession(s, candidate);
    if (!s.running) {
      void runCommissioningSession(this.runner, s, parseSetupCode(s.code), true, (err) =>
        this.fail(s, err),
      );
    }
    return snapshotCommissioningSession(s);
  }

  async provideCredentials(
    id: string,
    input: WifiCredentials | CommissioningCredentialsInput,
    auth?: { homeId?: string },
  ): Promise<CommissioningTransaction | undefined> {
    const s = this.sessions.get(id);
    if (!s) return undefined;
    if (auth?.homeId && s.homeId !== auth.homeId) throw new Error('wrong_home');
    if (s.tx.state !== 'OBTAIN_NETWORK_CREDENTIALS' || s.running) {
      return snapshotCommissioningSession(s);
    }

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
    emitCommissioningEvent(
      s,
      'network.credentials.provided',
      'NETWORK_PROVISION',
      'Network credentials provided',
      {
        wifi: redactWifiCredentials(wifi),
        thread: redactThreadDataset(threadDataset),
      },
    );

    void runCommissioningSession(this.runner, s, parseSetupCode(s.code), true, (err) =>
      this.fail(s, err),
    );
    return snapshotCommissioningSession(s);
  }

  loadMatcherRules(rules: readonly DiscoveryMatcherRule[]): void {
    this.matcherRules = [...rules];
  }

  refreshMatcherRules(): void {
    const catalogRules = this.catalog.getDiscoveryMatcherRules();
    const hasHomeKitController = catalogRules.some((r) => r.domain === 'homekit_controller');
    const extras = hasHomeKitController
      ? BUILTIN_DNS_SD_RULES.filter((r) => r.domain !== 'homekit')
      : BUILTIN_DNS_SD_RULES;
    this.loadMatcherRules([...catalogRules, ...extras]);
  }

  getMatcherRules(): readonly DiscoveryMatcherRule[] {
    return this.matcherRules;
  }

  matchesAdvertisement(input: DiscoveryAdvertisementInput): boolean {
    const details = mergeDiscoveryTxtDetails(input.protocol, input.details);
    return Boolean(selectBestDiscoveryMatch(this.matcherRules, { ...input, details }));
  }

  async refreshCatalog(): Promise<HaIntegrationCatalog> {
    const updated = await this.catalog.refreshCatalog();
    this.refreshMatcherRules();
    await this.haCatalogRefreshHook?.();
    return updated;
  }

  async restorePersistedDiscoveryState(): Promise<void> {
    if (this.persistedDiscoveryRestored) return;
    this.persistedDiscoveryRestored = true;
    await loadIgnoredDiscoveries(this.homeService?.getPersistence(), this.discovery);
  }

  async reconcileConfigured(): Promise<void> {
    await reconcileConfiguredDiscoveries(
      this.discovery,
      this.homekit,
      this.entriesService,
      this.catalog.getCatalog(),
    );
  }

  ingestDiscovery(input: DiscoveryAdvertisementInput): DiscoveredCandidate {
    const details = mergeDiscoveryTxtDetails(input.protocol, input.details);
    const normalized = { ...input, details };
    const candidate = this.discovery.ingest(normalized, this.matcherRules);
    this.haDiscoveryIngestedHook?.(candidate, normalized);
    return candidate;
  }

  listDiscoveries(filter?: DiscoveryFilter): readonly DiscoveredCandidate[] {
    return this.discovery.listCandidates(filter);
  }
  getDiscovery(id: string): DiscoveredCandidate | undefined {
    return this.discovery.getCandidate(id);
  }
  ignoreDiscovery(id: string): boolean {
    const ok = this.discovery.ignore(id);
    if (ok) void saveIgnoredDiscovery(this.homeService?.getPersistence(), id);
    return ok;
  }
  unignoreDiscovery(id: string): boolean {
    const ok = this.discovery.unignore(id);
    if (ok) void removeIgnoredDiscovery(this.homeService?.getPersistence(), id);
    return ok;
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
  async refreshFlow(
    flowId: string,
    auth: { homeId: string; userId?: string },
  ): Promise<IntegrationFlowStep | undefined> {
    if (this.entriesService) {
      return this.entriesService.refreshFlowWithPersistence(this.flows, flowId, auth, (d) =>
        this.catalog.getCatalog().getManifest(d),
      );
    }
    return this.flows.refreshFlow(flowId, auth);
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
  async cancelFlowAsync(
    flowId: string,
    auth: { homeId: string; userId?: string },
  ): Promise<boolean> {
    return this.flows.cancelFlowAsync(flowId, auth);
  }
  listActiveFlows(homeId: string): readonly IntegrationFlowStep[] {
    return this.flows.listActiveFlows(homeId);
  }

  private fail(session: Session, error: string): void {
    if (session.tx.state === 'CANCELLED') return;
    this.radios.revokeAllLeasesForSession(session.tx.commissioningId);
    this.logger.warn(`Commissioning ${session.tx.commissioningId} failed: ${error}`);
    updateCommissioningSession(session, { state: 'FAILED', error });
    emitCommissioningEvent(session, 'commission.failed', 'FAILED', error);
    wipeSessionCredentials(session);
  }
}
