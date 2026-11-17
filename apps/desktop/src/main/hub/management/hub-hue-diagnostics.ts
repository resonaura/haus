/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

export interface HubHueDiagnosticsResult {
  readonly handled: boolean;
  readonly result?: unknown;
}

export async function handleHubHueDiagnostics(
  method: unknown,
  rawPath: unknown,
  api: (path: string) => Promise<unknown>,
): Promise<HubHueDiagnosticsResult> {
  if (typeof rawPath !== 'string') return { handled: false };
  const path = rawPath.replace(/^\/+/, '');
  const match = /^diagnostics\/config_entry\/([^/?#]+)$/.exec(path);
  if (!match) return { handled: false };
  if (typeof method !== 'string' || method.toUpperCase() !== 'GET') {
    throw new Error('Hue scene diagnostics are read-only.');
  }
  let entryId: string;
  try {
    entryId = decodeURIComponent(match[1]!);
  } catch {
    throw new Error('Invalid Hue config entry.');
  }
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(entryId)) {
    throw new Error('Invalid Hue config entry.');
  }
  return {
    handled: true,
    result: await api(`/api/commissioning/hue/scene-diagnostics/${encodeURIComponent(entryId)}`),
  };
}
