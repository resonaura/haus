/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { isRecord } from '@haus/core/record';
const validSshServerId = (value: unknown) =>
  typeof value === 'string' &&
  /^ssh:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
export function validateServiceOperation(method: unknown, path: string, data: unknown) {
  if (method === 'GET' && path === '/api/kitsune/catalog') return true;
  if (
    method === 'POST' &&
    /^\/api\/kitsune\/[a-z][a-z0-9-]*\/(enable|settings|create|onboard)$/.test(path)
  )
    return (
      isRecord(data) &&
      (path.endsWith('/onboard')
        ? Object.keys(data).join(',') === 'fields' &&
          isRecord(data.fields) &&
          Object.values(data.fields).every((value) => typeof value === 'string')
        : path.endsWith('/create')
          ? Object.keys(data).join(',') === 'settings' && isRecord(data.settings)
          : Object.keys(data).length === 0)
    );
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
    ['/api/cluster', '/api/servers', '/api/backups', '/api/preferences'].includes(path);
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
        ].includes(key),
      )
    );
  if (path === '/api/cluster/nodes' && method === 'POST')
    return (
      typeof data.name === 'string' &&
      typeof data.url === 'string' &&
      typeof data.key === 'string' &&
      typeof data.allowHttp === 'boolean' &&
      Array.isArray(data.roles) &&
      data.roles.every((role) => ['storage', 'stream'].includes(String(role))) &&
      (data.sshServerId === undefined || validSshServerId(data.sshServerId)) &&
      Object.keys(data).every((key) =>
        ['name', 'url', 'key', 'allowHttp', 'roles', 'sshServerId'].includes(key),
      )
    );
  if (
    (/^\/api\/cluster\/nodes\/[a-f0-9-]{36}$/.test(path) ||
      path === '/api/servers/home-assistant') &&
    method === 'PATCH'
  ) {
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
  if (/^\/api\/cluster\/nodes\/[a-f0-9-]{36}\/remove$/.test(path) && method === 'POST')
    return Object.keys(data).length === 0;
  if (path === '/api/backups/create' && method === 'POST')
    return ['haus', 'ha'].includes(String(data.kind)) && Object.keys(data).length === 1;
  if (path === '/api/backups/recovery' && method === 'POST') return Object.keys(data).length === 0;
  return false;
}
export function recordingSource(value: unknown) {
  try {
    if (
      !isRecord(value) ||
      typeof value.url !== 'string' ||
      typeof value.expiresAt !== 'number' ||
      !Number.isSafeInteger(value.expiresAt) ||
      value.expiresAt < Date.now() ||
      value.expiresAt > Date.now() + 125000
    )
      return undefined;
    const url = new URL(value.url);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.hash ||
      !/^\/media\/[a-f0-9]{64}$/.test(url.pathname) ||
      url.search.length > 300 ||
      !/^\d{13}$/.test(url.searchParams.get('expires') ?? '') ||
      !/^[a-f0-9]{32}$/.test(url.searchParams.get('nonce') ?? '') ||
      !/^[a-f0-9]{64}$/.test(url.searchParams.get('signature') ?? '')
    )
      return undefined;
    if (
      Number(url.searchParams.get('expires')) !== value.expiresAt ||
      [...url.searchParams.keys()].some((key) => !['expires', 'nonce', 'signature'].includes(key))
    )
      return undefined;
    return { url: url.href, expiresAt: value.expiresAt };
  } catch {
    return undefined;
  }
}
