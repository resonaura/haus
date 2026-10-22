import { useState } from 'react';
import { Button } from '@heroui/react';
import type { HausNative } from '../../../../shared/native';
import type { HausAccessory, Snapshot } from '../../model';
import { entityReferenceHits, rewriteEntityReferences } from '../../model/entity-reference-rewrite';

type ConfigDocument = {
  label: string;
  config: Record<string, unknown>;
  save: (config: Record<string, unknown>) => Promise<void>;
  writable: boolean;
};
type Scan = { documents: ConfigDocument[]; hits: string[]; blockers: string[] };
const slug = /^[a-z0-9_-]{1,128}$/i;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const unwrap = (value: unknown) =>
  record(value) && record(value.config) ? value.config : record(value) ? value : null;

async function scanReferences(api: HausNative, snapshot: Snapshot, from: string): Promise<Scan> {
  const documents: ConfigDocument[] = [];
  const hits: string[] = [];
  const blockers: string[] = [];
  const add = (
    label: string,
    config: Record<string, unknown>,
    save: ConfigDocument['save'],
    writable = true,
  ) => {
    const found = entityReferenceHits(config, from);
    if (found.length) {
      hits.push(`${label} (${found.length})`);
      if (!writable) blockers.push(label);
    }
    documents.push({ label, config, save, writable });
  };

  for (const state of snapshot.states.filter((item) => item.entity_id.startsWith('automation.'))) {
    const id = state.attributes.id;
    const label = `Automation: ${String(state.attributes.friendly_name ?? state.entity_id)}`;
    const editable = typeof id === 'string' && slug.test(id);
    const path = editable ? `config/automation/config/${id}` : '';
    const config = editable
      ? unwrap(await api.management({ method: 'GET', path }))
      : unwrap(await api.request({ type: 'automation/config', entity_id: state.entity_id }));
    if (!config)
      throw new Error(`Home Assistant did not return the config for ${state.entity_id}.`);
    add(
      label,
      config,
      async (next) => {
        if (!editable)
          throw new Error(`${label} can't be edited through Home Assistant's config API.`);
        await api.management({ method: 'POST', path, data: next });
      },
      editable,
    );
  }

  for (const state of snapshot.states.filter((item) => item.entity_id.startsWith('script.'))) {
    const id = state.attributes.id;
    const label = `Script: ${String(state.attributes.friendly_name ?? state.entity_id)}`;
    const editable = typeof id === 'string' && slug.test(id);
    const path = editable ? `config/script/config/${id}` : '';
    const config = editable
      ? unwrap(await api.management({ method: 'GET', path }))
      : unwrap(await api.request({ type: 'script/config', entity_id: state.entity_id }));
    if (!config)
      throw new Error(`Home Assistant did not return the config for ${state.entity_id}.`);
    add(
      label,
      config,
      async (next) => {
        if (!editable)
          throw new Error(`${label} can't be edited through Home Assistant's config API.`);
        await api.management({ method: 'POST', path, data: next });
      },
      editable,
    );
  }

  for (const state of snapshot.states.filter((item) => item.entity_id.startsWith('scene.'))) {
    const id = state.attributes.id;
    const entry = snapshot.entities.find((item) => item.entity_id === state.entity_id);
    if (entry?.platform !== 'homeassistant' || typeof id !== 'string' || !slug.test(id)) continue;
    const config = unwrap(await api.getSceneConfig(state.entity_id, id));
    if (!config)
      throw new Error(
        `Can't safely inspect scene “${String(state.attributes.friendly_name ?? state.entity_id)}”.`,
      );
    const path = `config/scene/config/${id}`;
    add(
      `Scene: ${String(state.attributes.friendly_name ?? state.entity_id)}`,
      config,
      async (next) => {
        await api.management({ method: 'POST', path, data: next });
      },
    );
  }

  const dashboards = await api.request<Array<{ title?: string; url_path?: string; mode?: string }>>(
    {
      type: 'lovelace/dashboards/list',
    },
  );
  const paths = [
    { label: 'Overview dashboard', url_path: undefined as string | undefined, mode: 'storage' },
    ...dashboards.map((item) => ({
      label: `Dashboard: ${item.title ?? item.url_path ?? 'Untitled'}`,
      url_path: item.url_path,
      mode: item.mode,
    })),
  ];
  for (const dashboard of paths) {
    const config = await api.request<unknown>({
      type: 'lovelace/config',
      ...(dashboard.url_path ? { url_path: dashboard.url_path } : {}),
    });
    if (!record(config)) throw new Error(`Can't safely inspect ${dashboard.label}.`);
    const readOnly = dashboard.mode === 'yaml';
    add(
      dashboard.label,
      config,
      async (next) => {
        if (readOnly)
          throw new Error(
            `${dashboard.label} is YAML-managed and can't be migrated automatically.`,
          );
        await api.request({
          type: 'lovelace/config/save',
          config: next,
          ...(dashboard.url_path ? { url_path: dashboard.url_path } : {}),
        });
      },
      !readOnly,
    );
  }
  return { documents, hits, blockers };
}

function disabledEntityId(snapshot: Snapshot, canonical: string) {
  const used = new Set(snapshot.entities.map((item) => item.entity_id));
  const base = `water_heater.disabled_${canonical.split('.')[1]}`;
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}_${suffix}`)) suffix++;
  return `${base}_${suffix}`;
}

export function KettleEntityIdentity({
  accessory,
  snapshot,
}: {
  accessory: HausAccessory;
  snapshot: Snapshot;
}) {
  const activeId = accessory.primaryEntityId;
  const legacy = accessory.secondaryEntities.find(
    (item) => item.entity_id.startsWith('water_heater.') && item.state === 'unavailable',
  );
  const [scan, setScan] = useState<Scan>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const api = window.hausNative;

  const inspect = async () => {
    if (!api) throw new Error('Connect to Home Assistant first.');
    const activeEntry = snapshot.entities.find((item) => item.entity_id === activeId);
    const legacyEntry =
      legacy && snapshot.entities.find((item) => item.entity_id === legacy.entity_id);
    if (activeEntry?.platform !== 'mqtt' || legacyEntry?.platform !== 'xiaomi_miot')
      throw new Error('The active MQTT kettle and old Xiaomi entity could not be verified.');
    const result = await scanReferences(api, snapshot, activeId);
    setScan(result);
    return result;
  };

  const run = async () => {
    if (!api || !legacy) return;
    setBusy(true);
    setMessage('');
    let oldRenamed = false;
    let activeRenamed = false;
    const written: ConfigDocument[] = [];
    try {
      const latest = await inspect();
      if (latest.blockers.length)
        throw new Error(
          `No changes made. These configs use the suffixed ID but can't be safely edited: ${latest.blockers.join(', ')}.`,
        );
      const canonical = legacy.entity_id;
      // Detect conflicting scene keys before any entity or config is changed.
      const changes = latest.documents
        .map((document) => ({
          document,
          next: rewriteEntityReferences(document.config, activeId, canonical),
        }))
        .filter(({ document, next }) => JSON.stringify(next) !== JSON.stringify(document.config));
      const disabledId = disabledEntityId(snapshot, legacy.entity_id);
      await api.request({
        type: 'config/entity_registry/update',
        entity_id: canonical,
        new_entity_id: disabledId,
        name: 'Disabled: Kettle',
      });
      oldRenamed = true;
      await api.request({
        type: 'config/entity_registry/update',
        entity_id: activeId,
        new_entity_id: canonical,
      });
      activeRenamed = true;
      for (const { document, next } of changes) {
        await document.save(next);
        written.push(document);
      }
      setMessage(
        `Done. The MQTT kettle is now ${canonical}; the old Xiaomi entity is ${disabledId} (“Disabled: Kettle”).` +
          (latest.hits.length
            ? ` Updated ${latest.hits.length} configuration references.`
            : ' No saved configuration references needed changes.'),
      );
      setScan(undefined);
    } catch (error) {
      const rollbackFailures: string[] = [];
      for (const document of written.reverse())
        try {
          await document.save(document.config);
        } catch {
          rollbackFailures.push(document.label);
        }
      if (activeRenamed)
        try {
          await api.request({
            type: 'config/entity_registry/update',
            entity_id: legacy.entity_id,
            new_entity_id: activeId,
          });
        } catch {
          rollbackFailures.push('entity registry');
        }
      if (oldRenamed)
        try {
          const disabledId = disabledEntityId(snapshot, legacy.entity_id);
          await api.request({
            type: 'config/entity_registry/update',
            entity_id: disabledId,
            new_entity_id: legacy.entity_id,
            name:
              snapshot.entities.find((entry) => entry.entity_id === legacy.entity_id)?.name ?? null,
          });
        } catch {
          rollbackFailures.push('entity registry');
        }
      const reason = error instanceof Error ? error.message : String(error);
      setMessage(
        rollbackFailures.length
          ? `${reason} Some changes could not be restored: ${[...new Set(rollbackFailures)].join(', ')}. Review these in Home Assistant before retrying.`
          : reason,
      );
    } finally {
      setBusy(false);
    }
  };

  if (!legacy || !activeId.endsWith('_2')) return null;
  return (
    <section className="haus-visibility-settings">
      <div className="haus-visibility-heading">
        <div>
          <h3>Kettle entity identity</h3>
          <p>
            Make the live MQTT entity canonical and label the unavailable Xiaomi copy as disabled.
          </p>
        </div>
      </div>
      <p className="haus-settings-note">
        Live: <code>{activeId}</code>
        <br />
        Old: <code>{legacy.entity_id}</code>
      </p>
      {!scan ? (
        <Button
          variant="secondary"
          isDisabled={busy || !snapshot.user.is_admin}
          onPress={() => {
            setBusy(true);
            setMessage('');
            void inspect()
              .catch((error) => setMessage(error instanceof Error ? error.message : String(error)))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? 'Checking references…' : 'Check references'}
        </Button>
      ) : (
        <>
          <p className="haus-settings-note">
            {scan.hits.length
              ? `Found ${scan.hits.length} saved automation, script, scene or dashboard configs using the suffixed ID. Haus will update those exact references.`
              : 'No saved automation, script, scene or dashboard uses the suffixed ID.'}
          </p>
          {scan.hits.length > 0 && <p className="haus-settings-note">{scan.hits.join(' · ')}</p>}
          {scan.blockers.length > 0 && (
            <p className="haus-settings-note" role="alert">
              Can't safely update: {scan.blockers.join(' · ')}. No entities have been changed.
            </p>
          )}
          <Button
            variant="secondary"
            isDisabled={busy || !snapshot.user.is_admin || scan.blockers.length > 0}
            onPress={() => void run()}
          >
            {busy ? 'Updating IDs…' : 'Make live kettle primary'}
          </Button>
        </>
      )}
      {message && (
        <p className="haus-settings-note" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
