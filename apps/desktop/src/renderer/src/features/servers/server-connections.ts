/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { ServerSshHubTarget, ServerSshServer } from '../../../../shared/terminal';
import type { HomeServer } from './types';

const LOOPBACK_HOSTS = new Set([
  'localhost',
  'localhost.localdomain',
  '127.0.0.1',
  '::1',
  '0.0.0.0',
]);

function normalizeHost(value: string | undefined | null): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
}

function hostMatches(candidate: string, target: string): boolean {
  if (!candidate || !target || LOOPBACK_HOSTS.has(candidate) || LOOPBACK_HOSTS.has(target))
    return false;
  if (candidate === target) return true;
  const stripLocal = (v: string) => (v.endsWith('.local') ? v.slice(0, -6) : v);
  return stripLocal(candidate) === stripLocal(target);
}

export function hostFromServerUrl(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return '';
  }
}

export function defaultTerminalHost(server: HomeServer): string {
  return hostFromServerUrl(server.url) || server.host?.hostname || '';
}

export const serverIsLocalHub = (server: HomeServer) =>
  server.kind === 'home-assistant' || server.local === true;

export function hubSshTargets(managed: readonly HomeServer[]): ServerSshHubTarget[] {
  return managed
    .filter((server) => server.kind !== 'ssh')
    .map((server) => {
      const host = hostFromServerUrl(server.url);
      const hostname = server.host?.hostname ?? undefined;
      return {
        id: server.id,
        ...(host ? { host } : {}),
        ...(hostname ? { hostname } : {}),
        ...(serverIsLocalHub(server) ? { local: true } : {}),
      };
    });
}

function profileMatchesManagedServer(profile: ServerSshServer, server: HomeServer): boolean {
  if (profile.serverId === server.id || profile.serverId === server.sshServerId) return true;
  if (profile.serverId === 'home-assistant' && serverIsLocalHub(server)) return true;
  const profileHost = normalizeHost(profile.host);
  if (!profileHost) return false;
  return (
    hostMatches(profileHost, normalizeHost(hostFromServerUrl(server.url))) ||
    hostMatches(profileHost, normalizeHost(server.host?.hostname))
  );
}

export function hasDuplicateHubSshProfiles(
  managed: readonly HomeServer[],
  profiles: readonly ServerSshServer[],
): boolean {
  const managedServers = managed.filter((server) => server.kind !== 'ssh');
  const directIds = new Set<string>();
  for (const server of managedServers) {
    directIds.add(server.id);
    if (server.sshServerId) directIds.add(server.sshServerId);
  }
  return profiles.some(
    (profile) =>
      !directIds.has(profile.serverId) &&
      managedServers.some((server) => profileMatchesManagedServer(profile, server)),
  );
}

/** Keep a machine's shared identity while attaching local SSH access to its telemetry. */
export function mergeServerConnections(managed: HomeServer[], profiles: ServerSshServer[]) {
  const byId = new Map(profiles.map((profile) => [profile.serverId, profile]));
  const identities = new Set<string>();
  const managedServers = managed.filter((server) => server.kind !== 'ssh');
  const result = managedServers.map((server) => {
    const id = server.sshServerId || server.id;
    identities.add(server.id);
    identities.add(id);
    const profile = byId.get(id);
    if (!server.sshServerId) return server;
    return {
      ...server,
      id,
      managedId: server.id,
      monitoringOnline: server.online === true,
      ...(profile
        ? {
            kind: 'ssh' as const,
            online: profile.online ?? server.online,
            url: `ssh://${profile.host.includes(':') ? `[${profile.host}]` : profile.host}:${profile.port}`,
          }
        : {}),
    };
  });
  for (const profile of profiles) {
    // Terminal credentials for a managed server (or a Hub matched by host/legacy ID) do not create another device.
    if (identities.has(profile.serverId)) continue;
    if (managedServers.some((server) => profileMatchesManagedServer(profile, server))) continue;
    result.push({
      id: profile.serverId,
      kind: 'ssh',
      name: `${profile.username}@${profile.host}`,
      online: profile.online,
      host: null,
      url: `ssh://${profile.host.includes(':') ? `[${profile.host}]` : profile.host}:${profile.port}`,
    });
  }
  return result;
}

export const serverManagementId = (server: HomeServer) => server.managedId ?? server.id;
export const serverHasNvr = (server: HomeServer) =>
  server.kind === 'home-assistant' ||
  (server.roles ? server.roles.length > 0 : server.kind === 'nvr' || server.kind === 'hub');
