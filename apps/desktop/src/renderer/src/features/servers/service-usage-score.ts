/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  computeServiceUsageScore,
  formatServiceCpuPercent,
  normalizeServiceCpuPercent,
  resolveServiceCpuBasis,
} from '@haus/core/transport';
import type { ServerCpuPercentBasis, ServerHost } from './types';

export function serviceCpuBasis(
  host: ServerHost,
  kind: 'docker' | 'pm2' | 'systemServices',
): ServerCpuPercentBasis | null {
  return resolveServiceCpuBasis(host[kind], kind);
}

/** Convert each provider's declared units once, at the presentation boundary. */
export function normalizeServiceCpu(
  cpu: number | null,
  basis: ServerCpuPercentBasis | null,
  logicalCores: number | null,
) {
  return normalizeServiceCpuPercent(cpu, basis, logicalCores);
}

export function serviceCpuPercent(cpu: number | null) {
  return formatServiceCpuPercent(cpu);
}

/** Larger resource fractions gain nonlinear weight, without diluting either input. */
export function serviceUsageScore(
  cpu: number | null,
  memory: number | null,
  totalMemory: number | null,
) {
  return computeServiceUsageScore(cpu, memory, totalMemory);
}
