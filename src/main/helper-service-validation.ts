import { isRecord } from './validation';
export function validateServiceOperation(method: unknown, path: string, data: unknown) {
  if (method === 'POST' && /^\/api\/cameras\/camera\.[a-z0-9_]+\/warm$/.test(path))
    return (
      isRecord(data) &&
      typeof data.active === 'boolean' &&
      (data.preview === undefined || typeof data.preview === 'boolean') &&
      Object.keys(data).every((key) => ['active', 'preview'].includes(key))
    );
  const read =
    method === 'GET' && ['/api/cluster', '/api/backups', '/api/preferences'].includes(path);
  if (read) return true;
  if (!isRecord(data)) return false;
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
      Object.keys(data).every((key) => ['name', 'url', 'key', 'allowHttp', 'roles'].includes(key))
    );
  if (/^\/api\/cluster\/nodes\/[a-f0-9-]{36}$/.test(path) && method === 'PATCH')
    return typeof data.enabled === 'boolean' && Object.keys(data).length === 1;
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
