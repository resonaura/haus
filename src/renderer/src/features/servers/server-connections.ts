import type { ServerSshServer } from '../../../../shared/terminal';
import type { HomeServer } from './types';

/** Keep a machine's shared identity while attaching local SSH access to its telemetry. */
export function mergeServerConnections(managed: HomeServer[], profiles: ServerSshServer[]) {
  const byId = new Map(profiles.map((profile) => [profile.serverId, profile]));
  const identities = new Set<string>();
  const result = managed
    .filter((server) => server.kind !== 'ssh')
    .map((server) => {
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
    // Terminal credentials for a managed server do not create another device.
    if (identities.has(profile.serverId)) continue;
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
  (server.roles ? server.roles.length > 0 : server.kind === 'nvr');
