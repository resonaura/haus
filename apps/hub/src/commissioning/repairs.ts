/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import {
  Inject,
  Injectable,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { FlowSource, IntegrationFlowStep } from '@haus/core';
import { STANDALONE_HOME_SERVICE, type StandaloneHomeService } from '../home/home.service.js';
import { StandaloneHomePersistence } from '../home/home.persistence.js';
import { KITSUNE_SERVICE, type IKitsuneService } from '../kitsune/kitsune.controller.js';
import { CATALOG_TRANSACTIONS } from '../storage/storage.module.js';
import type { Transactions } from '../storage/transactions.js';
import { HubIntegrationEntryService } from './entries.js';
import { parseKitsuneCompatibility } from './entry-helpers.js';
import { readInstalledCustomManifests } from './ha-flow/runtime-operations.js';
import { CommissioningService } from './service.js';

export type RepairSeverity = 'warning' | 'error' | 'critical';

export interface RepairIssueRecord {
  readonly domain: string;
  readonly issue_id: string;
  readonly severity: RepairSeverity;
  readonly title: string;
  readonly description?: string;
  readonly is_fixable: boolean;
  readonly is_persistent: boolean;
  readonly ignored: boolean;
  readonly breaks_in_ha_version?: string;
  readonly learn_more_url?: string;
  readonly created: string;
  readonly entryId?: string;
  readonly sourceLabel?: string;
  readonly translation_key?: string;
  readonly translation_placeholders?: Readonly<Record<string, string>>;
}

interface PendingRepairFlow {
  readonly domain: string;
  readonly issueId: string;
  readonly entryId?: string;
  readonly fallback?: boolean;
  readonly fallbackStep?: IntegrationFlowStep;
}

function isRepairFallbackError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = 'code' in err && typeof err.code === 'string' ? err.code : '';
  if (
    code === 'UnknownStep' ||
    code === 'UnknownHandler' ||
    code === 'InvalidHandler' ||
    code === 'missing_requirements'
  ) {
    return true;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /doesn't support step/i.test(msg) ||
    /unknown (step|handler)/i.test(msg) ||
    /invalid handler/i.test(msg) ||
    msg === 'ha_flow_runtime_unavailable'
  );
}

function isRepairSuccessStep(step: IntegrationFlowStep): boolean {
  if (step.type === 'create_entry' || Boolean(step.result?.entryId)) return true;
  return (
    step.type === 'abort' &&
    (step.abortReason === 'reauth_successful' || step.abortReason === 'reconfigure_successful')
  );
}

@Injectable()
export class HubRepairsService implements OnModuleInit, OnModuleDestroy {
  private readonly persistence: StandaloneHomePersistence;
  private readonly persistedIssues = new Map<string, RepairIssueRecord>();
  private readonly ignoredIds = new Map<string, boolean>();
  private readonly activeRepairFlows = new Map<string, PendingRepairFlow>();
  private loaded = false;
  private loadingPromise?: Promise<void>;

  constructor(
    private readonly commissioning: CommissioningService,
    private readonly entries: HubIntegrationEntryService,
    @Optional() @Inject(STANDALONE_HOME_SERVICE) _homeService?: StandaloneHomeService,
    @Optional() @Inject(CATALOG_TRANSACTIONS) transactions?: Transactions,
    @Optional() @Inject(KITSUNE_SERVICE) private readonly kitsune?: IKitsuneService,
  ) {
    this.persistence = new StandaloneHomePersistence(transactions);
  }

  async onModuleInit(): Promise<void> {
    await this.ensureLoaded();
  }

  onModuleDestroy(): void {
    this.persistence.close();
  }

  private key(domain: string, issueId: string): string {
    return `${domain}:${issueId}`;
  }

  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    if (!this.loadingPromise) {
      this.loadingPromise = this.persistence
        .listByKind<RepairIssueRecord & { readonly kind?: string }>('repair_issue')
        .then((rows) => {
          for (const row of rows) {
            if (row.entryId.startsWith('ignored:')) {
              this.ignoredIds.set(
                row.entryId.slice('ignored:'.length),
                Boolean(row.value?.ignored),
              );
            } else if (row.value?.domain && row.value?.issue_id) {
              this.persistedIssues.set(this.key(row.value.domain, row.value.issue_id), row.value);
            }
          }
          this.loaded = true;
        })
        .catch(() => {
          this.loaded = true;
        });
    }
    await this.loadingPromise;
  }

  async raiseIssue(input: {
    readonly domain: string;
    readonly issueId: string;
    readonly severity?: RepairSeverity;
    readonly title: string;
    readonly description?: string;
    readonly entryId?: string;
    readonly learnMoreUrl?: string;
    readonly isFixable?: boolean;
  }): Promise<RepairIssueRecord> {
    await this.ensureLoaded();
    const k = this.key(input.domain, input.issueId);
    const record: RepairIssueRecord = {
      domain: input.domain,
      issue_id: input.issueId,
      severity: input.severity ?? 'error',
      title: input.title,
      description: input.description,
      is_fixable: input.isFixable ?? true,
      is_persistent: true,
      ignored: this.ignoredIds.get(k) ?? false,
      learn_more_url: input.learnMoreUrl,
      created: new Date().toISOString(),
      entryId: input.entryId,
      sourceLabel: 'Haus Hub Integration',
    };
    this.persistedIssues.set(k, record);
    await this.persistence.save('repair_issue', k, record);
    return record;
  }

  async resolveIssue(domain: string, issueId: string): Promise<boolean> {
    await this.ensureLoaded();
    const k = this.key(domain, issueId);
    const existed = this.persistedIssues.delete(k);
    this.ignoredIds.delete(k);
    await this.persistence.remove('repair_issue', k);
    await this.persistence.remove('repair_issue', `ignored:${k}`);
    return existed;
  }

  async ignoreIssue(
    domain: string,
    issueId: string,
    ignore = true,
  ): Promise<RepairIssueRecord | undefined> {
    await this.ensureLoaded();
    const k = this.key(domain, issueId);
    if (ignore) {
      this.ignoredIds.set(k, true);
      await this.persistence.save('repair_issue', `ignored:${k}`, { ignored: true });
    } else {
      this.ignoredIds.delete(k);
      await this.persistence.remove('repair_issue', `ignored:${k}`);
    }
    const existing = this.persistedIssues.get(k);
    if (existing) {
      const updated = { ...existing, ignored: ignore };
      this.persistedIssues.set(k, updated);
      await this.persistence.save('repair_issue', k, updated);
      return updated;
    }
    const all = await this.listIssues();
    return all.find((item) => item.domain === domain && item.issue_id === issueId);
  }

  async listIssues(): Promise<readonly RepairIssueRecord[]> {
    await this.ensureLoaded();
    const collected = new Map<string, RepairIssueRecord>();

    for (const [k, issue] of this.persistedIssues) {
      collected.set(k, { ...issue, ignored: this.ignoredIds.get(k) ?? issue.ignored });
    }

    const entries = await this.entries.listEntries();
    for (const entry of entries) {
      if (entry.state !== 'setup_error' && entry.state !== 'setup_retry') continue;
      const issueId = `entry_${entry.entry_id}`;
      const k = this.key(entry.domain, issueId);
      if (collected.has(k)) continue;
      collected.set(k, {
        domain: entry.domain,
        issue_id: issueId,
        severity: entry.state === 'setup_error' ? 'error' : 'warning',
        title: `Authentication or setup attention needed for ${entry.title}`,
        description: entry.reason ?? `Entry ${entry.title} is in ${entry.state} state.`,
        is_fixable: true,
        is_persistent: false,
        ignored: this.ignoredIds.get(k) ?? false,
        learn_more_url: entry.documentationUrl,
        created: entry.updatedAt,
        entryId: entry.entry_id,
        sourceLabel: entry.runtimeType,
      });
    }

    if (this.kitsune?.compatibility) {
      try {
        const compat = parseKitsuneCompatibility(this.kitsune.compatibility());
        for (const diag of compat.diagnostics) {
          if (diag.level !== 'error') continue;
          const issueId = `kitsune_${diag.plugin}_${diag.code}`;
          const k = this.key(diag.plugin, issueId);
          if (collected.has(k)) continue;
          collected.set(k, {
            domain: diag.plugin,
            issue_id: issueId,
            severity: 'error',
            title: `${diag.plugin}: ${diag.message}`,
            description: `Plugin diagnostic (${diag.code})`,
            is_fixable: true,
            is_persistent: false,
            ignored: this.ignoredIds.get(k) ?? false,
            created: new Date(diag.timestamp || Date.now()).toISOString(),
            sourceLabel: 'Compatibility Runtime',
          });
        }
      } catch {
        // Ignore diagnostic probe errors
      }
    }

    return Array.from(collected.values()).sort((a, b) => b.created.localeCompare(a.created));
  }

  private resolveDisplayName(domain: string): string {
    return (
      this.commissioning.catalog.getCatalog().getManifest(domain)?.name ||
      readInstalledCustomManifests().find((m) => m.domain === domain)?.name ||
      domain
    );
  }

  private async finalizeResolvedFlow(meta: PendingRepairFlow): Promise<void> {
    await this.resolveIssue(meta.domain, meta.issueId);
    if (meta.entryId) {
      await this.entries.setEntryState(meta.entryId, 'loaded', null);
    }
  }

  async startFixFlow(input: {
    readonly handler: string;
    readonly issueId: string;
    readonly homeId: string;
    readonly userId: string;
  }): Promise<IntegrationFlowStep> {
    const issues = await this.listIssues();
    const issue = issues.find((i) => i.domain === input.handler && i.issue_id === input.issueId);
    const entryId =
      issue?.entryId ??
      (input.issueId.startsWith('entry_') ? input.issueId.slice('entry_'.length) : undefined);
    const displayName = this.resolveDisplayName(input.handler);
    const candidateSources: readonly FlowSource[] = entryId
      ? ['repair', 'reauth', 'reconfigure']
      : ['repair'];

    for (const source of candidateSources) {
      let step: IntegrationFlowStep;
      try {
        step = await this.commissioning.startFlow({
          domain: input.handler,
          source,
          entryId,
          ...(source === 'reauth' || source === 'repair' ? { reauthEntryId: entryId } : {}),
          homeId: input.homeId,
          userId: input.userId,
        });
      } catch (err: unknown) {
        if (isRepairFallbackError(err)) continue;
        throw err;
      }
      if (isRepairSuccessStep(step)) {
        await this.finalizeResolvedFlow({ domain: input.handler, issueId: input.issueId, entryId });
        return step;
      }
      if (step.type !== 'abort') {
        this.activeRepairFlows.set(step.flowId, {
          domain: input.handler,
          issueId: input.issueId,
          entryId,
        });
        return step;
      }
    }

    const fallbackFlowId = `repair_flow_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const fallbackStep: IntegrationFlowStep = {
      type: 'form',
      flowId: fallbackFlowId,
      handler: input.handler,
      stepId: 'confirm',
      title: issue?.title ?? `Repair ${displayName}`,
      description:
        issue?.description ??
        `Confirm reloading or dismissing the repair issue for ${displayName}.`,
      documentationUrl: issue?.learn_more_url,
      lastStep: true,
      dataSchema: [
        {
          name: 'reload_entry',
          type: 'boolean',
          label: 'Reload integration entry after resolving',
          defaultValue: true,
        },
      ],
    };
    this.activeRepairFlows.set(fallbackFlowId, {
      domain: input.handler,
      issueId: input.issueId,
      entryId,
      fallback: true,
      fallbackStep,
    });
    return fallbackStep;
  }

  async getFixFlow(
    flowId: string,
    auth: { homeId: string; userId?: string },
  ): Promise<IntegrationFlowStep | undefined> {
    const meta = this.activeRepairFlows.get(flowId);
    if (!meta) return undefined;
    if (meta.fallback) return meta.fallbackStep;
    const step = await this.commissioning.refreshFlow(flowId, auth);
    if (!step) return undefined;
    if (isRepairSuccessStep(step)) {
      await this.finalizeResolvedFlow(meta);
      this.activeRepairFlows.delete(flowId);
    } else if (step.type === 'abort') {
      this.activeRepairFlows.delete(flowId);
    }
    return step;
  }

  async submitFixStep(input: {
    readonly flowId: string;
    readonly homeId: string;
    readonly userId: string;
    readonly values: Readonly<Record<string, unknown>>;
    readonly nextStepId?: string;
  }): Promise<IntegrationFlowStep> {
    const meta = this.activeRepairFlows.get(input.flowId);
    if (!meta) throw new Error('flow_not_found');

    if (meta.fallback) {
      const displayName = this.resolveDisplayName(meta.domain);
      await this.resolveIssue(meta.domain, meta.issueId);
      if (meta.entryId && input.values.reload_entry !== false) {
        await this.entries.reloadEntry(meta.entryId);
      }
      this.activeRepairFlows.delete(input.flowId);
      return {
        type: 'create_entry',
        flowId: input.flowId,
        handler: meta.domain,
        stepId: 'done',
        title: `Repaired ${displayName}`,
        result: { entryId: meta.entryId ?? meta.issueId, title: displayName },
      };
    }

    const step = await this.commissioning.submitFlowStep({
      flowId: input.flowId,
      homeId: input.homeId,
      userId: input.userId,
      nextStepId: input.nextStepId,
      values: input.values,
    });

    if (isRepairSuccessStep(step)) {
      await this.finalizeResolvedFlow(meta);
      this.activeRepairFlows.delete(input.flowId);
    } else if (step.type === 'abort') {
      this.activeRepairFlows.delete(input.flowId);
    }
    return step;
  }

  cancelFixFlow(flowId: string, auth: { homeId: string }): boolean {
    const meta = this.activeRepairFlows.get(flowId);
    if (!meta) return false;
    this.activeRepairFlows.delete(flowId);
    if (meta.fallback) return true;
    return this.commissioning.cancelFlow(flowId, auth);
  }
}
