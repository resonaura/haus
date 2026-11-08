/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

const fraction = (value: number | undefined, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;

export interface AnalysisRemoteSummary {
  relayOrigin?: string;
  features?: {
    autonomousCameraActivity?: number;
  };
  detectors?: {
    supported?: boolean;
    active?: number;
    max?: number;
  };
  resources?: {
    cpu?: number;
    memoryBytes?: number;
    memoryUsedBytes?: number;
    pressured?: boolean;
    analysisPressured?: boolean;
  };
  host?: {
    cpu?: {
      usage?: number;
    };
  };
  streams?: {
    active?: number;
    max?: number;
  };
  cameraActivity?: {
    cameras?: Array<{
      cameraId: string;
      policyId: string;
      expiresAt: number;
      admitted?: boolean;
      ready?: boolean;
      state?: string;
    }>;
  };
}

export interface AnalysisNode {
  id: string;
  name?: string;
  enabled?: boolean;
  roles: string[];
  url: string;
  key: string;
  allowHttp?: boolean;
  ca?: string;
  advertiseHost?: string;
}

export interface AnalysisNodeHealth {
  online?: boolean;
  remote?: AnalysisRemoteSummary;
}

export interface AssignedAnalysisJob {
  node?: { id: string };
}

/** Compare actual pressure and reserved analysis slots, not the host's CPU count. */
export function analysisLoad(remote: AnalysisRemoteSummary, assigned = 0): number {
  const detectors = remote.detectors ?? {};
  const maxDetectors = detectors.max ?? 0;
  const reserved = Math.max(assigned, detectors.active ?? 0) / Math.max(1, maxDetectors);
  const resources = remote.resources ?? {};
  const cpu = Math.max(fraction(resources.cpu, 0.5), fraction(remote.host?.cpu?.usage));
  const memory =
    (resources.memoryBytes ?? 0) > 0
      ? fraction((resources.memoryUsedBytes ?? 0) / (resources.memoryBytes ?? 1), 0.5)
      : 0.5;
  const streams =
    (remote.streams?.max ?? 0) > 0
      ? fraction((remote.streams?.active ?? 0) / (remote.streams?.max ?? 1))
      : 0;
  return Math.max(cpu, memory, reserved) + (cpu + memory + reserved + streams) * 0.15;
}

export function analysisCandidates<TNode extends AnalysisNode>(
  nodes: readonly TNode[],
  health: ReadonlyMap<string, AnalysisNodeHealth>,
  jobs: ReadonlyMap<string, AssignedAnalysisJob>,
  cooldowns: ReadonlyMap<string, number>,
  now: number,
): TNode[] {
  const assignments = new Map<string, number>();
  for (const job of jobs.values()) {
    if (job.node) {
      assignments.set(job.node.id, (assignments.get(job.node.id) ?? 0) + 1);
    }
  }
  return nodes
    .filter((node) => {
      const status = health.get(node.id);
      const remote = status?.remote;
      const detectors = remote?.detectors;
      return Boolean(
        node.enabled &&
          node.roles.includes('stream') &&
          status?.online &&
          detectors?.supported &&
          (remote?.relayOrigin || remote?.features?.autonomousCameraActivity === 1) &&
          !remote?.resources?.pressured &&
          !remote?.resources?.analysisPressured &&
          typeof detectors.max === 'number' &&
          Number.isFinite(detectors.max) &&
          detectors.max > 0 &&
          (cooldowns.get(node.id) ?? 0) <= now &&
          Math.max(assignments.get(node.id) ?? 0, detectors.active ?? 0) < detectors.max,
      );
    })
    .sort((a, b) => {
      const remoteA = health.get(a.id)?.remote ?? {};
      const remoteB = health.get(b.id)?.remote ?? {};
      return (
        analysisLoad(remoteA, assignments.get(a.id)) -
          analysisLoad(remoteB, assignments.get(b.id)) ||
        (remoteB.detectors?.max ?? 0) - (remoteA.detectors?.max ?? 0) ||
        a.id.localeCompare(b.id)
      );
    });
}
