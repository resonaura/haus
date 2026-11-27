/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { isIconAppearance, isIconTintColor, isIconVariation } from '@haus/core/preferences';
import { isRecord } from '@haus/core/record';

export { recordingSource } from '@haus/core/hub';

const validSshServerId = (value: unknown) =>
  typeof value === 'string' &&
  /^ssh:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);

const HA_VIDEO_NODE_ID = '[a-f0-9-]{36}';
const videoNodePath = new RegExp(`^/api/cluster/nodes/${HA_VIDEO_NODE_ID}$`);
const videoDrainPlanPath = new RegExp(`^/api/cluster/nodes/${HA_VIDEO_NODE_ID}/drain-plan$`);
const videoDrainPath = new RegExp(`^/api/cluster/nodes/${HA_VIDEO_NODE_ID}/drain$`);
const videoRemovePath = new RegExp(`^/api/cluster/nodes/${HA_VIDEO_NODE_ID}/remove$`);
const videoNodeIdExact = new RegExp(`^${HA_VIDEO_NODE_ID}$`);

const HA_VIDEO_ROLES = ['storage', 'stream'];

/**
 * Validates service operations for Home Assistant hubs (`haus-helper` add-on / HA appliance).
 * Clustering on Home Assistant hubs is strictly scoped to video/NVR nodes (`storage` | `stream`),
 * without Haus Hub coordinator/radio/bridge mesh operations.
 */
export function validateServiceOperation(method: unknown, path: string, data: unknown): boolean {
  const providerId = '[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}';
  if (
    method === 'GET' &&
    (['/api/providers', '/api/providers/handover'].includes(path) ||
      new RegExp(`^/api/providers/${providerId}(?:/migration)?$`).test(path))
  )
    return true;
  if (method === 'POST' && isRecord(data)) {
    const migration = new RegExp(
      `^/api/providers/${providerId}/migration/(review|apply|undo)$`,
    ).exec(path);
    if (migration) {
      if (migration[1] === 'review') return Object.keys(data).length === 0;
      if (typeof data.revision !== 'string' || !/^[a-f0-9]{64}$/.test(data.revision)) return false;
      return migration[1] === 'undo'
        ? Object.keys(data).join(',') === 'revision'
        : Object.keys(data).sort().join(',') === 'retire,revision' &&
            Array.isArray(data.retire) &&
            data.retire.length <= 512 &&
            data.retire.every((id) => typeof id === 'string' && /^[a-z_]+\.[a-z0-9_]+$/.test(id));
    }
    if (path === '/api/providers/connect')
      return (
        Object.keys(data).join(',') === 'bridgeId' &&
        typeof data.bridgeId === 'string' &&
        new RegExp(`^${providerId}$`).test(data.bridgeId)
      );
    if (
      path === '/api/providers/discover' ||
      new RegExp(`^/api/providers/${providerId}/(?:remove|handover)$`).test(path)
    )
      return Object.keys(data).length === 0;
    if (path === '/api/providers/enroll')
      return (
        Object.keys(data).sort().join(',') === 'allowHttp,code,url' &&
        typeof data.url === 'string' &&
        data.url.length <= 2048 &&
        typeof data.code === 'string' &&
        /^[a-f0-9]{48}$/.test(data.code) &&
        typeof data.allowHttp === 'boolean'
      );
    if (new RegExp(`^/api/providers/${providerId}/import$`).test(path))
      return (
        Object.keys(data).join(',') === 'cameras' &&
        Array.isArray(data.cameras) &&
        data.cameras.length > 0 &&
        data.cameras.length <= 128 &&
        data.cameras.every(
          (id) => typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(id),
        )
      );
  }
  if (method === 'POST' && /^\/api\/cameras\/camera\.[a-z0-9_]+\/warm$/.test(path))
    return (
      isRecord(data) &&
      typeof data.active === 'boolean' &&
      (data.preview === undefined || typeof data.preview === 'boolean') &&
      Object.keys(data).every((key) => ['active', 'preview'].includes(key))
    );
  if (method === 'POST' && /^\/api\/cameras\/camera\.[a-z0-9_]+\/viewer(?:\/close)?$/.test(path)) {
    if (
      !isRecord(data) ||
      typeof data.viewerId !== 'string' ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(data.viewerId)
    )
      return false;
    if (path.endsWith('/close')) return Object.keys(data).length === 1;
    return (
      Object.keys(data).length === 2 &&
      typeof data.offer === 'string' &&
      data.offer.startsWith('v=0') &&
      data.offer.length <= 62000 &&
      !data.offer.includes('\0')
    );
  }
  const read =
    method === 'GET' &&
    ([
      '/api/brands/status',
      '/api/cluster',
      '/api/servers',
      '/api/backups',
      '/api/preferences',
    ].includes(path) ||
      videoDrainPlanPath.test(path));
  if (read) return true;
  if (!isRecord(data)) return false;
  if (method === 'POST' && /^\/api\/events\/[a-f0-9-]{36}\/repair$/.test(path))
    return Object.keys(data).length === 0;
  if (path === '/api/preferences' && method === 'PATCH')
    return (
      typeof data.baseRevision === 'string' &&
      isRecord(data.patch) &&
      Object.keys(data.patch).every((key) =>
        [
          'favorites',
          'hiddenApp',
          'hiddenHome',
          'unhiddenApp',
          'deviceOrder',
          'autoGroupLights',
          'disabledLightGroups',
          'roomIcons',
          'serverDevices',
          'iconAppearance',
          'iconVariation',
          'iconTintColor',
        ].includes(key),
      ) &&
      (!('iconAppearance' in data.patch) || isIconAppearance(data.patch.iconAppearance)) &&
      (!('iconVariation' in data.patch) || isIconVariation(data.patch.iconVariation)) &&
      (!('iconTintColor' in data.patch) || isIconTintColor(data.patch.iconTintColor))
    );
  if (path === '/api/cluster/nodes' && method === 'POST') {
    const authKey = typeof data.key === 'string' ? data.key : data.token;
    return (
      typeof data.name === 'string' &&
      typeof data.url === 'string' &&
      typeof authKey === 'string' &&
      authKey.length > 0 &&
      (data.allowHttp === undefined || typeof data.allowHttp === 'boolean') &&
      Array.isArray(data.roles) &&
      data.roles.length > 0 &&
      data.roles.every((role) => HA_VIDEO_ROLES.includes(String(role))) &&
      (data.sshServerId === undefined || validSshServerId(data.sshServerId)) &&
      (data.nodeId === undefined ||
        (typeof data.nodeId === 'string' && videoNodeIdExact.test(data.nodeId))) &&
      Object.keys(data).every((key) =>
        ['name', 'url', 'key', 'token', 'allowHttp', 'roles', 'sshServerId', 'nodeId'].includes(
          key,
        ),
      )
    );
  }
  if ((videoNodePath.test(path) || path === '/api/servers/home-assistant') && method === 'PATCH') {
    const keys = Object.keys(data);
    return (
      keys.length > 0 &&
      keys.every(
        (key) =>
          key === 'storageLimitBytes' ||
          (['enabled', 'sshServerId', 'livePriority'].includes(key) &&
            path !== '/api/servers/home-assistant'),
      ) &&
      (data.enabled === undefined || typeof data.enabled === 'boolean') &&
      (data.livePriority === undefined ||
        (typeof data.livePriority === 'number' &&
          Number.isInteger(data.livePriority) &&
          data.livePriority >= 0 &&
          data.livePriority <= 100)) &&
      (data.sshServerId === undefined ||
        data.sshServerId === null ||
        validSshServerId(data.sshServerId)) &&
      (!Object.hasOwn(data, 'sshServerId') || keys.length === 1) &&
      (data.storageLimitBytes === undefined ||
        data.storageLimitBytes === null ||
        (typeof data.storageLimitBytes === 'number' &&
          Number.isSafeInteger(data.storageLimitBytes) &&
          data.storageLimitBytes > 0))
    );
  }
  if (videoDrainPath.test(path) && method === 'POST') return Object.keys(data).length === 0;
  if (videoRemovePath.test(path) && method === 'POST')
    return (
      Object.keys(data).every((key) => key === 'force') &&
      (data.force === undefined || typeof data.force === 'boolean')
    );
  if (path === '/api/backups/create' && method === 'POST')
    return ['haus', 'ha'].includes(String(data.kind)) && Object.keys(data).length === 1;
  if (path === '/api/backups/recovery' && method === 'POST') return Object.keys(data).length === 0;
  return false;
}
