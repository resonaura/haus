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
