/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
/** Read configurations only to protect references. Never return/store their contents in a journal/UI. */
export async function nativeMigrationDocuments(ha, registry, cancelled = () => false) {
  const ids = [
    ...new Set([...registry.states, ...registry.entities].map((item) => item.entity_id)),
  ];
  const tasks = ids
    .filter((id) => /^(automation|script)\./.test(id))
    .map((id) => async () => {
      const kind = id.split('.')[0];
      const result = await ha.request({ type: `${kind}/config`, entity_id: id });
      return { label: id, config: result?.config ?? result };
    });
  for (const entityId of ids.filter((id) => id.startsWith('scene.'))) {
    const state = registry.states.find((state) => state.entity_id === entityId);
    if (
      registry.entities.find((entity) => entity.entity_id === entityId)?.platform !==
      'homeassistant'
    )
      continue;
    const id = state?.attributes?.id;
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id))
      throw Error('migration_reference_scan_incomplete');
    tasks.push(async () => ({ label: entityId, config: await ha.migrationScene(id) }));
  }
  const dashboards = await ha.request({ type: 'lovelace/dashboards/list' });
  for (const url_path of new Set([undefined, ...dashboards.map((item) => item.url_path)]))
    tasks.push(async () => {
      try {
        return {
          label: url_path ? `Dashboard: ${url_path}` : 'Overview dashboard',
          config: await ha.request({ type: 'lovelace/config', ...(url_path ? { url_path } : {}) }),
        };
      } catch (error) {
        if (error.message === 'config_not_found') return null;
        throw error;
      }
    });
  if (tasks.length > 1024) throw Error('migration_reference_scan_too_large');
  const documents = [];
  let bytes = 0;
  for (let offset = 0; offset < tasks.length; offset += 4) {
    if (cancelled()) throw Error('migration_stopping');
    for (const document of await Promise.all(
      tasks.slice(offset, offset + 4).map((task) => task()),
    )) {
      if (!document) continue;
      if (!document.config || typeof document.config !== 'object')
        throw Error('migration_reference_scan_incomplete');
      bytes += Buffer.byteLength(JSON.stringify(document.config));
      if (bytes > 16 * 1024 * 1024) throw Error('migration_reference_scan_too_large');
      documents.push(document);
    }
  }
  return documents;
}
