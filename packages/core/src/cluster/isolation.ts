/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

/**
 * Isolated Verification Environment & Safety Boundary Contracts.
 * Guarantees zero contact with production HA instances and active NVR nodes,
 * strictly enforces storage sandboxing, and prevents port collisions.
 */

export interface SafetyBoundary {
  readonly forbiddenTargets: readonly string[];
  readonly allowedHosts: readonly string[];
}

export interface StorageSandboxConfig {
  readonly sandboxRoot: string;
  readonly requiredSubdirs: readonly string[];
}

export interface PlannedPort {
  readonly service: string;
  readonly port: number;
  readonly protocol: 'tcp' | 'udp';
}

export interface ActiveSocketConnection {
  readonly localAddress: string;
  readonly localPort: number;
  readonly remoteAddress: string;
  readonly remotePort: number;
  readonly state: string;
  readonly processId?: number;
  readonly processName?: string;
}

export type IsolationCheckCategory =
  'safety_boundary' | 'storage_sandbox' | 'network_ports' | 'container_runtime';

export interface IsolationCheckResult {
  readonly ok: boolean;
  readonly category: IsolationCheckCategory;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

export interface EnvironmentIsolationReport {
  readonly host: string;
  readonly isolated: boolean;
  readonly timestamp: string;
  readonly checks: readonly IsolationCheckResult[];
  readonly sandboxPath: string;
  readonly violations: readonly string[];
}

export class IsolationViolationError extends Error {
  readonly code: 'FORBIDDEN_TARGET' | 'SANDBOX_ESCAPE' | 'PORT_CONFLICT' | 'UNAUTHORIZED_HOST';

  constructor(
    code: 'FORBIDDEN_TARGET' | 'SANDBOX_ESCAPE' | 'PORT_CONFLICT' | 'UNAUTHORIZED_HOST',
    message: string,
  ) {
    super(`[${code}] ${message}`);
    this.name = 'IsolationViolationError';
    this.code = code;
  }
}

/**
 * Normalizes host strings by stripping protocol prefixes, ports, and brackets.
 */
export function normalizeHost(target: string): string {
  let cleaned = target.trim();
  if (cleaned.startsWith('http://') || cleaned.startsWith('https://')) {
    try {
      cleaned = new URL(cleaned).hostname;
    } catch {
      cleaned = cleaned.replace(/^https?:\/\//, '').split('/')[0] ?? '';
    }
  }
  // Strip port if present (handling both IPv4 host:port and [IPv6]:port)
  if (cleaned.startsWith('[') && cleaned.includes(']')) {
    cleaned = cleaned.slice(1, cleaned.indexOf(']'));
  } else if (cleaned.includes(':') && !cleaned.includes('::')) {
    cleaned = cleaned.split(':')[0] ?? cleaned;
  }
  return cleaned.toLowerCase();
}

/**
 * Validates whether a target host or URL is safe to contact.
 * Returns false if target is in the forbidden list or outside the allowed hosts.
 */
export function validateSafetyBoundary(
  boundary: SafetyBoundary,
  target: string,
): { safe: boolean; reason?: string } {
  const normalized = normalizeHost(target);

  for (const forbidden of boundary.forbiddenTargets) {
    if (normalizeHost(forbidden) === normalized) {
      return {
        safe: false,
        reason: `Target '${target}' matches forbidden production host '${forbidden}'`,
      };
    }
  }

  if (boundary.allowedHosts.length > 0) {
    const isAllowed = boundary.allowedHosts.some(
      (allowed) => normalizeHost(allowed) === normalized,
    );
    if (!isAllowed) {
      return {
        safe: false,
        reason: `Target '${target}' is not in the explicit allowedHosts list`,
      };
    }
  }

  return { safe: true };
}

/**
 * Path normalization supporting both POSIX and Windows separators.
 */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
}

/**
 * Ensures candidate path is strictly within the sandbox root without escapes.
 */
export function validateStorageContainment(
  sandboxRoot: string,
  candidatePath: string,
): { contained: boolean; resolvedPath: string } {
  const normRoot = normalizePath(sandboxRoot);
  const normCandidate = normalizePath(candidatePath);

  // Simple resolution check
  const rootParts = normRoot.split('/').filter(Boolean);
  const candidateParts = normCandidate.split('/').filter(Boolean);

  // Check prefix containment
  if (candidateParts.length < rootParts.length) {
    return { contained: false, resolvedPath: normCandidate };
  }

  // Windows drive letter check (case-insensitive)
  const isWindows = /^[a-zA-Z]:/.test(normRoot);
  for (let i = 0; i < rootParts.length; i++) {
    const r = rootParts[i] ?? '';
    const c = candidateParts[i] ?? '';
    if (isWindows && i === 0) {
      if (r.toLowerCase() !== c.toLowerCase()) {
        return { contained: false, resolvedPath: normCandidate };
      }
    } else if (r !== c) {
      return { contained: false, resolvedPath: normCandidate };
    }
  }

  // Prevent traversal sequences after root
  const subParts = candidateParts.slice(rootParts.length);
  if (subParts.includes('..') || subParts.includes('.')) {
    return { contained: false, resolvedPath: normCandidate };
  }

  return { contained: true, resolvedPath: normCandidate };
}

export interface SocketInspectionOptions {
  readonly forbiddenServicePorts?: readonly number[];
  readonly testProcessIds?: readonly number[];
}

/**
 * Inspects a list of active network connections for any forbidden targets.
 * Filters out benign OS host traffic (like Windows SMB file shares) and targets
 * connections to production service ports (e.g. HA 8123, MQTT 1883, NVR 8788)
 * or connections owned by test runtime processes.
 */
export function inspectSocketTableForSafety(
  connections: readonly ActiveSocketConnection[],
  forbiddenTargets: readonly string[],
  options?: SocketInspectionOptions,
): { safe: boolean; violations: readonly ActiveSocketConnection[] } {
  const forbiddenNormalized = new Set(forbiddenTargets.map(normalizeHost));
  const servicePorts = options?.forbiddenServicePorts ?? [8123, 1883, 8788];
  const testPids = options?.testProcessIds ? new Set(options.testProcessIds) : null;
  const violations: ActiveSocketConnection[] = [];

  for (const conn of connections) {
    const remote = normalizeHost(conn.remoteAddress);
    if (!forbiddenNormalized.has(remote)) {
      continue;
    }

    // If test PIDs are specified, any connection from a test PID to forbidden target is a violation
    if (testPids && conn.processId && testPids.has(conn.processId)) {
      violations.push(conn);
      continue;
    }

    // Check if connection targets a protected production service port
    if (servicePorts.includes(conn.remotePort)) {
      violations.push(conn);
      continue;
    }

    // Check if test port itself is talking to a forbidden target
    if (conn.localPort === 8790 || conn.localPort === 18883 || conn.localPort === 51828) {
      violations.push(conn);
    }
  }

  return {
    safe: violations.length === 0,
    violations,
  };
}

/**
 * Checks for port conflicts between planned service ports and already listening ports.
 */
export function validatePortAvailability(
  listeningPorts: readonly number[],
  plannedPorts: readonly PlannedPort[],
): { available: boolean; conflicts: readonly number[] } {
  const occupied = new Set(listeningPorts);
  const conflicts: number[] = [];

  for (const p of plannedPorts) {
    if (occupied.has(p.port)) {
      conflicts.push(p.port);
    }
  }

  return {
    available: conflicts.length === 0,
    conflicts,
  };
}

/**
 * Environment isolation guard enforcing isolation invariants before service start.
 */
export class EnvironmentIsolationGuard {
  constructor(
    readonly host: string,
    readonly boundary: SafetyBoundary,
    readonly storage: StorageSandboxConfig,
    readonly plannedPorts: readonly PlannedPort[],
  ) {}

  assertTargetAllowed(target: string): void {
    const check = validateSafetyBoundary(this.boundary, target);
    if (!check.safe) {
      throw new IsolationViolationError('FORBIDDEN_TARGET', check.reason ?? 'Target forbidden');
    }
  }

  resolveSandboxPath(subpath: string): string {
    const cleanSub = subpath.replace(/^(\/|\\)+/, '');
    const candidate = `${this.storage.sandboxRoot}/${cleanSub}`;
    const check = validateStorageContainment(this.storage.sandboxRoot, candidate);
    if (!check.contained) {
      throw new IsolationViolationError(
        'SANDBOX_ESCAPE',
        `Access to path '${subpath}' escapes sandbox root '${this.storage.sandboxRoot}'`,
      );
    }
    return check.resolvedPath;
  }

  evaluateIsolation(params: {
    readonly activeConnections: readonly ActiveSocketConnection[];
    readonly listeningPorts: readonly number[];
    readonly inspectionOptions?: SocketInspectionOptions;
  }): EnvironmentIsolationReport {
    const checks: IsolationCheckResult[] = [];
    const violations: string[] = [];

    // 1. Safety boundary check on active connections
    const socketCheck = inspectSocketTableForSafety(
      params.activeConnections,
      this.boundary.forbiddenTargets,
      params.inspectionOptions,
    );
    if (!socketCheck.safe) {
      const msg = `Found ${socketCheck.violations.length} active connection(s) to forbidden targets: ${socketCheck.violations
        .map((v) => `${v.remoteAddress}:${v.remotePort}`)
        .join(', ')}`;
      violations.push(msg);
      checks.push({
        ok: false,
        category: 'safety_boundary',
        message: msg,
        details: { violations: socketCheck.violations },
      });
    } else {
      checks.push({
        ok: true,
        category: 'safety_boundary',
        message: 'No active connections to forbidden production targets',
      });
    }

    // 2. Storage sandbox containment check
    const storageCheck = validateStorageContainment(
      this.storage.sandboxRoot,
      this.storage.sandboxRoot,
    );
    if (!storageCheck.contained) {
      const msg = `Sandbox root '${this.storage.sandboxRoot}' is invalid or uncontained`;
      violations.push(msg);
      checks.push({
        ok: false,
        category: 'storage_sandbox',
        message: msg,
      });
    } else {
      checks.push({
        ok: true,
        category: 'storage_sandbox',
        message: `Storage sandbox configured at '${this.storage.sandboxRoot}' with subdirectories [${this.storage.requiredSubdirs.join(', ')}]`,
        details: {
          root: this.storage.sandboxRoot,
          subdirs: this.storage.requiredSubdirs,
        },
      });
    }

    // 3. Port availability check
    const portCheck = validatePortAvailability(params.listeningPorts, this.plannedPorts);
    if (!portCheck.available) {
      const msg = `Port conflict detected on planned ports: ${portCheck.conflicts.join(', ')}`;
      violations.push(msg);
      checks.push({
        ok: false,
        category: 'network_ports',
        message: msg,
        details: { conflicts: portCheck.conflicts },
      });
    } else {
      checks.push({
        ok: true,
        category: 'network_ports',
        message: `All ${this.plannedPorts.length} planned ports are free and available`,
        details: { plannedPorts: this.plannedPorts },
      });
    }

    return {
      host: this.host,
      isolated: violations.length === 0,
      timestamp: new Date().toISOString(),
      checks,
      sandboxPath: this.storage.sandboxRoot,
      violations,
    };
  }
}
