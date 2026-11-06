/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

/** Archive metadata never promotes an old packet copy to a trusted normalized original. */
export function recordingProvenance(info: unknown): Record<string, unknown> {
  if (!isRecord(info)) return {};
  const value: Record<string, unknown> = {};
  for (const key of ['originalCompatible', 'compatibilityRepaired'] as const)
    if (typeof info[key] === 'boolean') value[key] = info[key];
  if (info.originalPolicyVersion === 1) value.originalPolicyVersion = 1;
  const source = info.originalProvenance;
  if (isRecord(source)) {
    if (source.kind === 'haus-encoder' && source.profile === 1)
      value.originalProvenance = { kind: 'haus-encoder', profile: 1 };
    else if (source.kind === 'camera') {
      const labels: Record<string, unknown> = { kind: 'camera' };
      // Strip ASCII control bytes (including CR/LF) without a control regex.
      const sanitize = (input: string): string =>
        Array.from(input, (char) => (char.charCodeAt(0) <= 31 ? '' : char)).join('');
      for (const key of ['platform', 'manufacturer', 'model'] as const)
        if (typeof source[key] === 'string') labels[key] = sanitize(source[key]).slice(0, 160);
      value.originalProvenance = labels;
    }
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
