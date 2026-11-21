/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */

export type HacsRepositoryCategory =
  'integration' | 'plugin' | 'theme' | 'template' | 'python_script' | 'appdaemon' | 'netdaemon';

export type HacsUpdatePhase =
  | 'review'
  | 'prepare'
  | 'download'
  | 'downloaded_not_activated'
  | 'activate'
  | 'verify'
  | 'installed'
  | 'rolled_back'
  | 'failed';

export type HacsCompatibilityStatus = 'verified' | 'unknown' | 'incompatible';

export interface KnownHacsRepositoryMeta {
  readonly id: string;
  readonly repo: string;
  readonly domain: string;
  readonly title: string;
  readonly category: HacsRepositoryCategory;
  readonly description: string;
  readonly defaultBranch?: string;
}

export const KNOWN_HACS_REPOS: Readonly<Record<string, KnownHacsRepositoryMeta>> = {
  hacs: {
    id: '172733314',
    repo: 'hacs/integration',
    domain: 'hacs',
    title: 'HACS',
    category: 'integration',
    description: 'Home Assistant Community Store integration manager.',
    defaultBranch: 'main',
  },
  xiaomi_miot: {
    id: '295081715',
    repo: 'al-one/hass-xiaomi-miot',
    domain: 'xiaomi_miot',
    title: 'Xiaomi Miot Auto',
    category: 'integration',
    description: 'Integrate Xiaomi devices via MIoT specification.',
    defaultBranch: 'master',
  },
  meross_lan: {
    id: '348697135',
    repo: 'krahabb/meross_lan',
    domain: 'meross_lan',
    title: 'Meross LAN',
    category: 'integration',
    description: 'Local Home Assistant integration for Meross devices.',
    defaultBranch: 'master',
  },
  sensibo: {
    id: '185614201',
    repo: 'GuyKh/sensibo-custom-component',
    domain: 'sensibo',
    title: 'Sensibo',
    category: 'integration',
    description: 'Sensibo climate custom component.',
    defaultBranch: 'master',
  },
  ble_monitor: {
    id: '266466521',
    repo: 'custom-components/ble_monitor',
    domain: 'ble_monitor',
    title: 'Passive BLE Monitor',
    category: 'integration',
    description: 'Passive Bluetooth LE sensor monitor.',
    defaultBranch: 'master',
  },
  localtuya: {
    id: '297892544',
    repo: 'rospogrigio/localtuya',
    domain: 'localtuya',
    title: 'LocalTuya',
    category: 'integration',
    description: 'Local handling for Tuya devices.',
    defaultBranch: 'master',
  },
  tuya_local: {
    id: '272272536',
    repo: 'make-all/tuya-local',
    domain: 'tuya_local',
    title: 'Tuya Local',
    category: 'integration',
    description: 'Local support for Tuya devices.',
    defaultBranch: 'main',
  },
  sonoff: {
    id: '242423000',
    repo: 'AlexxIT/SonoffLAN',
    domain: 'sonoff',
    title: 'Sonoff LAN',
    category: 'integration',
    description: 'Control Sonoff devices via LAN and Cloud.',
    defaultBranch: 'master',
  },
  dreame_vacuum: {
    id: '528416044',
    repo: 'Tasshack/dreame-vacuum',
    domain: 'dreame_vacuum',
    title: 'Dreame Vacuum',
    category: 'integration',
    description: 'Dreame vacuum integration.',
    defaultBranch: 'main',
  },
  tapo: {
    id: '299271001',
    repo: 'petretiandrea/home-assistant-tapo-p100',
    domain: 'tapo',
    title: 'Tapo Controller',
    category: 'integration',
    description: 'Control Tapo devices.',
    defaultBranch: 'main',
  },
  govee_lan: {
    id: '449852002',
    repo: 'wez/govee-lan-hass',
    domain: 'govee_lan',
    title: 'Govee LAN',
    category: 'integration',
    description: 'Control Govee lights over LAN.',
    defaultBranch: 'main',
  },
};

export interface HacsReleaseSummary {
  readonly tag: string;
  readonly name: string;
  readonly body: string;
  readonly prerelease: boolean;
  readonly htmlUrl?: string;
  readonly assetUrl?: string;
}

export interface HacsRepositoryView {
  readonly id: string;
  readonly name: string;
  readonly full_name: string;
  readonly description: string;
  readonly category: HacsRepositoryCategory;
  readonly domain?: string;
  readonly installed: boolean;
  readonly installed_version?: string;
  readonly available_version?: string;
  readonly pending_upgrade: boolean;
  readonly pending_restart?: boolean;
  readonly hide?: boolean;
  readonly custom?: boolean;
  readonly can_download: boolean;
  readonly config_flow?: boolean;
  readonly status?: string;
  readonly state?: string;
  readonly stars?: number;
  readonly downloads?: number;
  readonly additional_info?: string;
  readonly releases?: readonly string[];
  readonly beta?: boolean;
  readonly selected_tag?: string;
  readonly default_branch?: string;
  readonly hide_default_branch?: boolean;
  readonly compatibility: HacsCompatibilityStatus;
  readonly compatibility_reason?: string;
  readonly min_ha_version?: string;
  readonly release_url?: string;
  readonly release_summary?: string;
}

export interface HacsEntryCheckpoint {
  readonly entryId: string;
  readonly domain: string;
  readonly version?: string;
  readonly haVersion?: number;
  readonly haMinorVersion?: number;
  readonly state?: string;
}

export interface HacsUpdateOperation {
  readonly operationId: string;
  readonly targetId: string;
  readonly repositoryId: string;
  readonly repository: string;
  readonly domain: string;
  readonly title: string;
  readonly installedVersion: string;
  readonly targetVersion: string;
  readonly commitOrDigest?: string;
  readonly phase: HacsUpdatePhase;
  readonly revision: number;
  readonly bytesReceived: number;
  readonly totalBytes?: number;
  readonly compatibility: HacsCompatibilityStatus;
  readonly compatibilityReason?: string;
  readonly affectedEntries: readonly string[];
  readonly reauthRequired?: boolean;
  readonly failedPhase?: HacsUpdatePhase;
  readonly rollbackOutcome?: 'restored' | 'not_needed' | 'unresolved_migration' | 'failed';
  readonly runningVersion?: string;
  readonly error?: string;
  readonly startedAt: string;
  readonly updatedAt: string;
}

export interface HacsBatchUpdateResult {
  readonly completedCount: number;
  readonly totalCount: number;
  readonly succeeded: readonly HacsUpdateOperation[];
  readonly failed: readonly HacsUpdateOperation[];
}

export interface HacsRuntimeHooks {
  getRuntimeHaVersion?(): string | undefined;
  getAffectedEntries?(domain: string): Promise<readonly string[]>;
  captureEntryCheckpoint?(domain: string): Promise<readonly HacsEntryCheckpoint[]>;
  restoreEntryCheckpoint?(
    domain: string,
    checkpoints: readonly HacsEntryCheckpoint[],
  ): Promise<void>;
  prepareRequirements?(domain: string, requirements: readonly string[]): Promise<void>;
  beforeActivate?(domain: string, affectedEntries: readonly string[]): Promise<void>;
  verifyActivation?(
    domain: string,
    targetVersion: string,
    affectedEntries: readonly string[],
  ): Promise<{
    readonly ok: boolean;
    readonly reason?: string;
    readonly reauthRequired?: boolean;
    readonly irreversibleMigration?: boolean;
  }>;
  fenceCandidate?(domain: string, affectedEntries: readonly string[]): Promise<void>;
  verifyRestoredRuntime?(
    domain: string,
    restoredVersion: string,
    affectedEntries: readonly string[],
  ): Promise<void>;
  onInstalled?(domain: string, installedVersion: string): Promise<void>;
  onProgress?(operation: HacsUpdateOperation): void;
}

export function normalizeHacsVersion(version: string): string {
  return version.trim().replace(/^v/i, '');
}

export function deriveRepositoryId(fullName: string): string {
  for (const known of Object.values(KNOWN_HACS_REPOS)) {
    if (known.repo.toLowerCase() === fullName.toLowerCase()) return known.id;
  }
  let hash = 2166136261;
  for (const ch of fullName.toLowerCase()) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return String(100_000_000 + (hash % 899_999_999));
}

export function compareHacsVersions(a: string, b: string): number {
  const na = normalizeHacsVersion(a);
  const nb = normalizeHacsVersion(b);
  if (na === nb) return 0;
  if (!na || na === '0.0.0' || na === 'unknown' || na === 'none') return -1;
  if (!nb || nb === '0.0.0' || nb === 'unknown' || nb === 'none') return 1;
  const semverPattern = /^\d+(?:\.\d+)+/;
  if (!semverPattern.test(na) || !semverPattern.test(nb)) {
    return -1;
  }
  const pa = na.split(/[.+-]/).map((n) => Number.parseInt(n, 10) || 0);
  const pb = nb.split(/[.+-]/).map((n) => Number.parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length, 3);
  for (let i = 0; i < len; i += 1) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return -1;
}

export function evaluateHacsCompatibility(input: {
  readonly category: HacsRepositoryCategory;
  readonly hacsJson?: Record<string, unknown>;
  readonly manifest?: Record<string, unknown>;
  readonly runtimeHaVersion?: string;
}): {
  readonly status: HacsCompatibilityStatus;
  readonly reason?: string;
  readonly minHaVersion?: string;
} {
  if (input.category !== 'integration') {
    return {
      status: 'incompatible',
      reason: `Unsupported repository category '${input.category}'; only integration repositories can be activated.`,
    };
  }
  const minHa =
    typeof input.hacsJson?.homeassistant === 'string' && input.hacsJson.homeassistant.trim()
      ? input.hacsJson.homeassistant.trim()
      : undefined;
  if (minHa) {
    if (!input.runtimeHaVersion) {
      return {
        status: 'unknown',
        minHaVersion: minHa,
        reason: `Requires Home Assistant >= ${minHa}, but runtime version is unknown.`,
      };
    }
    if (compareHacsVersions(input.runtimeHaVersion, minHa) < 0) {
      return {
        status: 'incompatible',
        minHaVersion: minHa,
        reason: `Requires Home Assistant >= ${minHa} (runtime is ${input.runtimeHaVersion}).`,
      };
    }
    return { status: 'verified', minHaVersion: minHa };
  }
  if (!input.runtimeHaVersion) {
    return {
      status: 'unknown',
      reason: 'Runtime Home Assistant compatibility version has not been verified.',
    };
  }
  if (input.manifest && typeof input.manifest.domain === 'string') {
    return { status: 'verified' };
  }
  return {
    status: 'unknown',
    reason: 'Repository compatibility metadata will be verified during staging.',
  };
}

function parsePythonRequirement(spec: string): {
  readonly name: string;
  readonly exactVersion?: string;
  readonly minVersion?: string;
  readonly maxVersion?: string;
} | null {
  const cleaned = spec.split(';')[0]?.trim() ?? '';
  const match = /^([a-zA-Z0-9_.-]+)(?:\[[^\]]*\])?\s*(.*)$/.exec(cleaned);
  if (!match?.[1]) return null;
  const name = match[1].toLowerCase().replace(/[-_.]+/g, '-');
  const constraints = match[2]?.trim() ?? '';
  let exactVersion: string | undefined;
  let minVersion: string | undefined;
  let maxVersion: string | undefined;
  for (const part of constraints.split(',').map((s) => s.trim())) {
    if (part.startsWith('==')) exactVersion = part.slice(2).trim();
    else if (part.startsWith('>=')) minVersion = part.slice(2).trim();
    else if (part.startsWith('<=')) maxVersion = part.slice(2).trim();
    else if (part.startsWith('<')) maxVersion = part.slice(1).trim();
  }
  return { name, exactVersion, minVersion, maxVersion };
}

export function checkRequirementConflicts(
  domain: string,
  candidateRequirements: readonly string[],
  existingManifests: ReadonlyMap<
    string,
    { readonly domain: string; readonly requirements?: readonly string[] }
  >,
):
  | { readonly ok: true }
  | { readonly ok: false; readonly conflicts: readonly string[]; readonly reason: string } {
  const conflicts: string[] = [];
  for (const rawReq of candidateRequirements) {
    const candidate = parsePythonRequirement(rawReq);
    if (!candidate) continue;
    for (const [otherDomain, otherManifest] of existingManifests) {
      if (otherDomain === domain) continue;
      for (const otherRaw of otherManifest.requirements ?? []) {
        const other = parsePythonRequirement(otherRaw);
        if (!other || other.name !== candidate.name) continue;
        if (
          candidate.exactVersion &&
          other.exactVersion &&
          normalizeHacsVersion(candidate.exactVersion) !== normalizeHacsVersion(other.exactVersion)
        ) {
          conflicts.push(
            `${candidate.name}: ${domain} requires ==${candidate.exactVersion} while ${otherDomain} requires ==${other.exactVersion}`,
          );
        } else if (
          candidate.exactVersion &&
          other.minVersion &&
          compareHacsVersions(candidate.exactVersion, other.minVersion) < 0
        ) {
          conflicts.push(
            `${candidate.name}: ${domain} requires ==${candidate.exactVersion} which is below ${otherDomain} >=${other.minVersion}`,
          );
        } else if (
          other.exactVersion &&
          candidate.minVersion &&
          compareHacsVersions(other.exactVersion, candidate.minVersion) < 0
        ) {
          conflicts.push(
            `${candidate.name}: ${domain} requires >=${candidate.minVersion} while ${otherDomain} pins ==${other.exactVersion}`,
          );
        } else if (
          candidate.exactVersion &&
          other.maxVersion &&
          compareHacsVersions(candidate.exactVersion, other.maxVersion) >= 0
        ) {
          conflicts.push(
            `${candidate.name}: ${domain} requires ==${candidate.exactVersion} which exceeds ${otherDomain} <${other.maxVersion}`,
          );
        }
      }
    }
  }
  if (conflicts.length > 0) {
    return {
      ok: false,
      conflicts,
      reason: `Shared Python dependency conflict: ${conflicts.join('; ')}`,
    };
  }
  return { ok: true };
}
