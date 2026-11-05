/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { AppManifest } from './manifest.js';

export interface AppStartupResolution {
  readonly orderedApps: readonly AppManifest[];
  readonly missingDependencies: readonly { appId: string; dependency: string }[];
  readonly cycles: readonly (readonly string[])[];
}

export interface ServiceEndpoint {
  readonly host: string;
  readonly port: number;
  readonly username?: string;
  readonly password?: string;
  readonly protocol?: string;
}

/**
 * Resolves topological startup ordering for containerized Apps based on
 * explicit dependencies and declared service requirements (e.g. "mqtt:need").
 */
export function resolveAppStartupOrder(apps: readonly AppManifest[]): AppStartupResolution {
  const appMap = new Map<string, AppManifest>();
  const serviceProviders = new Map<string, string>(); // serviceName -> appId

  for (const app of apps) {
    appMap.set(app.id, app);
    if (app.services) {
      for (const s of app.services) {
        if (s.endsWith(':provide')) {
          const serviceName = s.slice(0, -8);
          serviceProviders.set(serviceName, app.id);
        }
      }
    }
  }

  // Common default provider mappings
  if (!serviceProviders.has('mqtt') && appMap.has('haus-mqtt')) {
    serviceProviders.set('mqtt', 'haus-mqtt');
  }

  // Build adjacency list: appId -> Set of dependency appIds that MUST start BEFORE appId
  const inEdges = new Map<string, Set<string>>();
  const missingDeps: { appId: string; dependency: string }[] = [];

  for (const app of apps) {
    const deps = new Set<string>();

    // Explicit app dependencies
    if (app.dependencies) {
      for (const depId of app.dependencies) {
        if (appMap.has(depId)) {
          deps.add(depId);
        } else {
          missingDeps.push({ appId: app.id, dependency: depId });
        }
      }
    }

    // Service dependencies: e.g. "mqtt:need"
    if (app.services) {
      for (const s of app.services) {
        if (s.endsWith(':need')) {
          const serviceName = s.slice(0, -5);
          const providerId = serviceProviders.get(serviceName);
          if (providerId && providerId !== app.id) {
            deps.add(providerId);
          } else if (!providerId) {
            missingDeps.push({ appId: app.id, dependency: `service:${serviceName}` });
          }
        }
      }
    }

    inEdges.set(app.id, deps);
  }

  // Kahn's algorithm for topological sorting
  // outEdges: providerId -> Set of consumers that depend on providerId
  const outEdges = new Map<string, Set<string>>();
  const indegree = new Map<string, number>();

  for (const app of apps) {
    outEdges.set(app.id, new Set());
    indegree.set(app.id, 0);
  }

  for (const [consumerId, providerIds] of inEdges.entries()) {
    indegree.set(consumerId, providerIds.size);
    for (const providerId of providerIds) {
      outEdges.get(providerId)?.add(consumerId);
    }
  }

  // Queue of nodes with no incoming dependencies (can start immediately)
  const queue: string[] = [];
  for (const [id, deg] of indegree.entries()) {
    if (deg === 0) {
      queue.push(id);
    }
  }

  const ordered: AppManifest[] = [];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const manifest = appMap.get(currentId);
    if (manifest) {
      ordered.push(manifest);
    }

    const dependents = outEdges.get(currentId) ?? new Set();
    for (const depId of dependents) {
      const remaining = (indegree.get(depId) ?? 1) - 1;
      indegree.set(depId, remaining);
      if (remaining === 0) {
        queue.push(depId);
      }
    }
  }

  // Check for cycles
  const cycles: string[][] = [];
  if (ordered.length < apps.length) {
    const remaining = apps.filter((a) => (indegree.get(a.id) ?? 0) > 0);
    cycles.push(remaining.map((a) => a.id));
  }

  return {
    orderedApps: ordered,
    missingDependencies: missingDeps,
    cycles,
  };
}

/**
 * Injects environment variables for discovered running services into an app container.
 */
export function injectServiceConfiguration(
  app: AppManifest,
  services: Record<string, ServiceEndpoint>,
): Record<string, string> {
  const env: Record<string, string> = {};

  if (!app.services) return env;

  for (const s of app.services) {
    if (s.endsWith(':need')) {
      const serviceName = s.slice(0, -5);
      const endpoint = services[serviceName];
      if (endpoint) {
        const prefix = serviceName.toUpperCase().replace(/[^A-Z0-9]/g, '_');
        env[`${prefix}_HOST`] = endpoint.host;
        env[`${prefix}_PORT`] = endpoint.port.toString();
        if (endpoint.username) {
          env[`${prefix}_USER`] = endpoint.username;
        }
        if (endpoint.password) {
          env[`${prefix}_PASSWORD`] = endpoint.password;
        }
      }
    }
  }

  return env;
}
