/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { HaFlowRuntime } from '@haus/kitsune';

type EnsureRuntime = () => Promise<unknown>;
type GetRuntime = () => HaFlowRuntime | undefined;

export async function getHueSceneDiagnostics(
  entryId: string,
  ensureStarted: EnsureRuntime,
  getRuntime: GetRuntime,
): Promise<{ data: Record<string, unknown> }> {
  await ensureStarted();
  const runtime = getRuntime();
  if (!runtime) throw new Error('ha_flow_runtime_unavailable');
  return runtime.hueSceneDiagnostics(entryId);
}

export async function uploadRuntimeFile(
  filename: string,
  content: Buffer,
  ensureStarted: EnsureRuntime,
  getRuntime: GetRuntime,
): Promise<{ readonly fileId: string; readonly file_id: string }> {
  await ensureStarted();
  const runtime = getRuntime();
  if (!runtime) throw new Error('ha_flow_runtime_unavailable');
  const result = await runtime.uploadFile(filename, content.toString('base64'));
  return { fileId: result.fileId, file_id: result.fileId };
}

export async function verifyDomainEntriesAfterUpdate(params: {
  readonly entryIds: readonly string[];
  readonly reloadEntry: (entryId: string) => Promise<{
    readonly ok: boolean;
    readonly state?: string;
    readonly reason?: string;
  }>;
}): Promise<{
  readonly ok: boolean;
  readonly reauthRequired?: boolean;
  readonly reason?: string;
}> {
  let reauthRequired = false;
  for (const entryId of params.entryIds) {
    try {
      const res = await params.reloadEntry(entryId);
      if (res.state === 'reauth_required' || res.reason?.includes('reauth')) {
        reauthRequired = true;
        continue;
      }
      if (!res.ok) {
        return { ok: false, reason: res.reason ?? `entry_reload_failed:${entryId}` };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes('reauth') || msg.toLowerCase().includes('auth')) {
        reauthRequired = true;
        continue;
      }
      return { ok: false, reason: msg };
    }
  }
  return { ok: true, ...(reauthRequired ? { reauthRequired: true } : {}) };
}
