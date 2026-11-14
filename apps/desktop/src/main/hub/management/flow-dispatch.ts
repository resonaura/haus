/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { buildHubManifests } from '../flow-entries.js';
import { normalizeCoreStepToHaStep } from './normalize.js';

export interface ActiveFlowEntry {
  handler: string;
  commissioningId?: string;
  candidateId?: string;
  accessoryId?: string;
  address?: string;
  port?: number;
  name?: string;
  nativeFlowId?: string;
  currentStepId?: string;
  isRepair?: boolean;
}

export interface NativeFlowDispatchContext {
  api: (path: string, init?: { method?: string; body?: unknown }) => Promise<unknown>;
  activeFlows: Map<string, ActiveFlowEntry>;
  fetchDiscovery: () => Promise<unknown>;
  refreshDevices: () => Promise<void>;
  getEntries?: () => ReadonlyArray<{ entry_id?: unknown; domain?: unknown }>;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export async function startNativeCommissioningFlow(
  ctx: NativeFlowDispatchContext,
  handler: string,
  fallbackFlowId: string,
  data: Record<string, unknown>,
  sourceOverride?: string,
): Promise<Record<string, unknown>> {
  const entryId = asString(data.entry_id) ?? asString(data.entryId);
  const reauthEntryId = asString(data.reauth_entry_id) ?? entryId;
  const candidateId = asString(data.candidateId) ?? asString(data.candidate_id);
  const preserveFlowId = Boolean(data.preserveFlowId);
  const explicitSource = asString(data.source);
  const reauthRequested =
    data.reauth === true || data.reauth === 'true' || Boolean(data.reauth_entry_id);
  const source =
    sourceOverride ??
    explicitSource ??
    (reauthRequested ? 'reauth' : entryId ? 'reconfigure' : 'user');
  const showAdvancedRaw = data.show_advanced_options ?? data.showAdvancedOptions;
  const showAdvancedOptions = typeof showAdvancedRaw === 'boolean' ? showAdvancedRaw : undefined;

  const res = (await ctx.api('/api/commissioning/flows', {
    method: 'POST',
    body: {
      domain: handler,
      source,
      ...(candidateId ? { candidateId } : {}),
      ...(entryId ? { entryId } : {}),
      ...(reauthEntryId && source === 'reauth' ? { reauthEntryId } : {}),
      ...(showAdvancedOptions !== undefined ? { showAdvancedOptions } : {}),
    },
  })) as Record<string, unknown>;

  const normalized = normalizeCoreStepToHaStep(res, fallbackFlowId, handler);
  const nativeFlowId =
    asString(res?.flowId) ?? asString(res?.flow_id) ?? String(normalized.flow_id ?? fallbackFlowId);
  const effectiveFlowId = preserveFlowId
    ? fallbackFlowId
    : String(normalized.flow_id ?? fallbackFlowId);
  const stepWithFlowId =
    preserveFlowId && normalized.flow_id !== effectiveFlowId
      ? { ...normalized, flow_id: effectiveFlowId }
      : normalized;
  const existing = ctx.activeFlows.get(effectiveFlowId);

  ctx.activeFlows.set(effectiveFlowId, {
    ...existing,
    handler: String(stepWithFlowId.handler ?? handler),
    ...(candidateId ? { candidateId } : {}),
    nativeFlowId,
    currentStepId: asString(stepWithFlowId.step_id),
  });
  return stepWithFlowId;
}

export async function fetchNativeFlowStep(
  ctx: NativeFlowDispatchContext,
  flowId: string,
  flow: ActiveFlowEntry,
): Promise<Record<string, unknown> | undefined> {
  if (!flow.nativeFlowId) return undefined;
  const endpoint = flow.isRepair
    ? `/api/repairs/issues/fix/${encodeURIComponent(flow.nativeFlowId)}`
    : `/api/commissioning/flows/${encodeURIComponent(flow.nativeFlowId)}`;
  const res = await ctx.api(endpoint);
  return normalizeCoreStepToHaStep(res, flowId, flow.handler);
}

export async function submitNativeFlowStep(
  ctx: NativeFlowDispatchContext,
  flowId: string,
  flow: ActiveFlowEntry,
  data: Record<string, unknown>,
): Promise<Record<string, unknown> | undefined> {
  if (!flow.nativeFlowId) return undefined;
  const nextStepId = asString(data.next_step_id) ?? asString(data.nextStepId);
  const stepId = asString(data.step_id) ?? flow.currentStepId;
  const endpoint = flow.isRepair
    ? `/api/repairs/issues/fix/${encodeURIComponent(flow.nativeFlowId)}`
    : `/api/commissioning/flows/${encodeURIComponent(flow.nativeFlowId)}/step`;

  const stepRes = await ctx.api(endpoint, {
    method: 'POST',
    body: {
      values: data,
      ...(nextStepId ? { nextStepId } : {}),
      ...(stepId ? { stepId } : {}),
    },
  });

  const normalized = normalizeCoreStepToHaStep(stepRes, flowId, flow.handler);
  flow.currentStepId = asString(normalized.step_id) ?? flow.currentStepId;
  if (normalized.type === 'create_entry') {
    ctx.activeFlows.delete(flowId);
    await ctx.fetchDiscovery().catch(() => undefined);
    await ctx.refreshDevices().catch(() => undefined);
  }
  return normalized;
}

async function resolveOptionsDomain(
  ctx: NativeFlowDispatchContext,
  entryOrHandler: string,
  explicitDomain?: string,
): Promise<string> {
  if (explicitDomain) return explicitDomain;
  if (!entryOrHandler) return 'unknown';
  if (entryOrHandler.includes(':')) return entryOrHandler.split(':')[0] || entryOrHandler;

  const cachedMatch = ctx
    .getEntries?.()
    .find((entry) => asString(entry.entry_id) === entryOrHandler && asString(entry.domain));
  if (cachedMatch) {
    const dom = asString(cachedMatch.domain);
    if (dom) return dom;
  }

  const integrationsRes = await ctx.api('/api/commissioning/integrations').catch(() => null);
  const rawEntries =
    integrationsRes &&
    typeof integrationsRes === 'object' &&
    'entries' in integrationsRes &&
    Array.isArray((integrationsRes as { entries?: unknown }).entries)
      ? (integrationsRes as { entries: Array<Record<string, unknown>> }).entries
      : [];
  const remoteMatch = rawEntries.find(
    (entry) => (asString(entry.entry_id) ?? asString(entry.entryId)) === entryOrHandler,
  );
  return (remoteMatch ? asString(remoteMatch.domain) : undefined) ?? entryOrHandler;
}

/** Handles Hub integration options, repairs fix flows, reloads, and persisted entry removal. */
export async function handleExtendedFlowManagement(
  ctx: NativeFlowDispatchContext,
  method: string,
  path: string,
  data: Record<string, unknown>,
): Promise<{ handled: true; result: unknown } | undefined> {
  // Options flow start
  if (method === 'POST' && path === 'config/config_entries/options/flow') {
    const entryOrHandler = asString(data.handler) ?? asString(data.entry_id) ?? '';
    const domain = await resolveOptionsDomain(ctx, entryOrHandler, asString(data.domain));
    const step = await startNativeCommissioningFlow(
      ctx,
      domain,
      `opt_${Date.now()}`,
      { ...data, entry_id: asString(data.entry_id) ?? asString(data.handler) },
      'options',
    );
    return { handled: true, result: step };
  }

  // Options flow step/get/cancel
  if (path.startsWith('config/config_entries/options/flow/')) {
    const flowId = path.slice('config/config_entries/options/flow/'.length);
    const flow = ctx.activeFlows.get(flowId);
    if (!flow?.nativeFlowId) return undefined;
    if (method === 'GET') {
      return { handled: true, result: await fetchNativeFlowStep(ctx, flowId, flow) };
    }
    if (method === 'POST') {
      return { handled: true, result: await submitNativeFlowStep(ctx, flowId, flow, data) };
    }
    if (method === 'DELETE') {
      await ctx
        .api(`/api/commissioning/flows/${encodeURIComponent(flow.nativeFlowId)}`, {
          method: 'DELETE',
        })
        .catch(() => {});
      ctx.activeFlows.delete(flowId);
      return { handled: true, result: {} };
    }
  }

  // Repair fix flows
  if (method === 'POST' && path === 'repairs/issues/fix') {
    const handler = asString(data.handler) ?? 'unknown';
    const issueId = asString(data.issue_id) ?? asString(data.issueId) ?? '';
    const res = (await ctx.api('/api/repairs/issues/fix', {
      method: 'POST',
      body: { handler, issue_id: issueId },
    })) as Record<string, unknown>;
    const normalized = normalizeCoreStepToHaStep(res, `repair_${Date.now()}`, handler);
    const effectiveFlowId = String(normalized.flow_id);
    const nativeFlowId = asString(res?.flowId) ?? asString(res?.flow_id) ?? effectiveFlowId;
    ctx.activeFlows.set(effectiveFlowId, {
      handler: String(normalized.handler ?? handler),
      nativeFlowId,
      currentStepId: asString(normalized.step_id),
      isRepair: true,
    });
    return { handled: true, result: normalized };
  }

  if (path.startsWith('repairs/issues/fix/')) {
    const flowId = path.slice('repairs/issues/fix/'.length);
    const flow = ctx.activeFlows.get(flowId);
    if (!flow?.nativeFlowId) {
      if (method === 'POST') {
        const res = await ctx.api(`/api/repairs/issues/fix/${encodeURIComponent(flowId)}`, {
          method: 'POST',
          body: {
            values: data,
            ...(asString(data.next_step_id) ? { nextStepId: data.next_step_id } : {}),
          },
        });
        const normalized = normalizeCoreStepToHaStep(res, flowId);
        if (normalized.type === 'create_entry') await ctx.refreshDevices().catch(() => {});
        return { handled: true, result: normalized };
      }
      return undefined;
    }
    if (method === 'POST') {
      return { handled: true, result: await submitNativeFlowStep(ctx, flowId, flow, data) };
    }
    if (method === 'DELETE') {
      await ctx
        .api(`/api/repairs/issues/fix/${encodeURIComponent(flow.nativeFlowId)}`, {
          method: 'DELETE',
        })
        .catch(() => {});
      ctx.activeFlows.delete(flowId);
      return { handled: true, result: {} };
    }
  }

  // Generic config entry reload
  if (
    method === 'POST' &&
    path.startsWith('config/config_entries/entry/') &&
    path.endsWith('/reload')
  ) {
    const entryId = decodeURIComponent(
      path.slice('config/config_entries/entry/'.length, -'/reload'.length),
    );
    await ctx
      .api(`/api/commissioning/entries/${encodeURIComponent(entryId)}/reload`, {
        method: 'POST',
        body: {},
      })
      .catch(() => {});
    await ctx.refreshDevices().catch(() => {});
    return { handled: true, result: { require_restart: false } };
  }

  return undefined;
}

export async function fetchHubFlowHandlers(
  api: (path: string, init?: { method?: string; body?: unknown }) => Promise<unknown>,
): Promise<string[]> {
  const merged = new Set<string>(buildHubManifests().map((m) => m.domain));
  const [catalogRes, integrationsRes] = await Promise.all([
    api('/api/catalog/integrations').catch(() => undefined) as Promise<
      { domains?: string[] } | undefined
    >,
    api('/api/commissioning/integrations').catch(() => undefined) as Promise<
      { domains?: string[] } | undefined
    >,
  ]);
  for (const d of catalogRes?.domains ?? []) merged.add(d);
  for (const d of integrationsRes?.domains ?? []) merged.add(d);
  return Array.from(merged);
}

export async function fetchHubManifests(
  api: (path: string, init?: { method?: string; body?: unknown }) => Promise<unknown>,
): Promise<Array<Record<string, unknown>>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const m of buildHubManifests()) {
    map.set(m.domain, { domain: m.domain, name: m.name });
  }
  const [catalogRes, integrationsRes] = await Promise.all([
    api('/api/catalog/integrations').catch(() => undefined) as Promise<
      { integrations?: Array<Record<string, unknown>> } | undefined
    >,
    api('/api/commissioning/integrations').catch(() => undefined) as Promise<
      { metadata?: Array<Record<string, unknown>> } | undefined
    >,
  ]);
  for (const m of catalogRes?.integrations ?? []) {
    if (typeof m.domain === 'string') {
      map.set(m.domain, { ...map.get(m.domain), ...m, domain: m.domain, name: m.name || m.domain });
    }
  }
  for (const meta of integrationsRes?.metadata ?? []) {
    if (typeof meta.domain === 'string') {
      const existing = map.get(meta.domain);
      map.set(meta.domain, {
        ...existing,
        ...meta,
        name:
          (typeof meta.name === 'string' && meta.name) ||
          (typeof existing?.name === 'string' && existing.name) ||
          meta.domain,
        iot_class: meta.iotClass,
        documentation: meta.documentationUrl,
        is_built_in: meta.runtimeType === 'built_in',
      });
    }
  }
  return Array.from(map.values());
}
