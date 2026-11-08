/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import assert from 'node:assert/strict';
import { test, onTestFinished } from 'vitest';
import { RecordingStore } from '@haus/hub/events';
import { openTestHaCatalog } from '../support/catalog.js';
import type { ReferenceDocument, RegistryDevice, RegistryEntity } from '@haus/bridge/migration';
import { NativeMigration, type NativeMigrationOptions } from '@haus/ha/node/native-migration';
import {
  nativeMigrationDocuments,
  type NativeSourcesLike,
} from '@haus/ha/node/native-migration-documents';

async function fixture() {
  const owner = await openTestHaCatalog();
  const store = new RecordingStore(owner.source, ':memory:', owner.transactions);
  onTestFinished(async () => {
    await store.close();
    await owner.close();
  });
  await store.setCamera('camera.one', { keep: true });
  const created = await store.create('camera.one', 'motion', 1000, 3000);
  await store.finish(created.id, { duration: 2, bytes: 100 });
  const scope = 'http://helper:8099';
  const entity = (
    id: string,
    entity_id: string,
    platform: string,
    unique_id: string,
    config_entry_id: string,
    device_id: string,
  ): RegistryEntity => ({
    id,
    entity_id,
    platform,
    unique_id,
    config_entry_id,
    device_id,
    name: null,
    icon: null,
    area_id: null,
    hidden_by: null,
    disabled_by: null,
    labels: [],
    aliases: [],
    categories: {},
    options: {},
  });
  const registry: {
    entities: RegistryEntity[];
    devices: RegistryDevice[];
    entries: Array<{ entry_id: string; domain: string; disabled_by?: string | null }>;
    states: Array<{ entity_id: string; attributes?: { id?: unknown } }>;
  } = {
    entities: [
      {
        ...entity('old-camera', 'camera.one', 'generic', 'old-camera', 'generic', 'generic-device'),
        name: 'My camera',
        icon: 'mdi:video',
        aliases: ['Porch'],
        labels: ['outside'],
        categories: { device: 'garden' },
      },
      {
        ...entity(
          'old-light',
          'light.porch',
          'mqtt',
          'physical_spotlight',
          'mqtt',
          'physical-device',
        ),
        disabled_by: 'user',
      },
      entity(
        'old-transport',
        'sensor.stream',
        'mqtt',
        'physical_rtsp_stream',
        'mqtt',
        'physical-device',
      ),
      entity(
        'native-camera',
        'camera.one_2',
        'haus',
        `haus_camera:${scope}:camera.one`,
        'haus',
        'native-device',
      ),
      entity(
        'native-light',
        'light.camera_light',
        'haus',
        `haus_native:${scope}:camera.one:spotlight`,
        'haus',
        'native-device',
      ),
      entity(
        'native-motion',
        'binary_sensor.activity',
        'haus',
        `haus_native:${scope}:camera.one:haus_activity`,
        'haus',
        'native-device',
      ),
    ],
    devices: [
      {
        id: 'physical-device',
        identifiers: [['mqtt', 'serial']],
        name: 'Porch',
        name_by_user: 'Garden camera',
        area_id: 'garden',
        labels: ['security'],
      },
      {
        id: 'native-device',
        identifiers: [['haus', 'bridge:physical']],
        name_by_user: null,
        area_id: null,
        labels: [],
      },
    ],
    entries: [
      { entry_id: 'generic', domain: 'generic', disabled_by: null },
      { entry_id: 'mqtt', domain: 'mqtt' },
      { entry_id: 'haus', domain: 'haus' },
    ],
    states: [],
  };
  const writes: Array<Record<string, unknown>> = [],
    refs: ReferenceDocument[] = [];
  let failAfterRename = false;
  const ha = {
    registry: async () => structuredClone(registry),
    request: async (input: Record<string, unknown>): Promise<unknown> => {
      if (input.type === 'config_entries/get') return structuredClone(registry.entries);
      if (input.type === 'config/entity_registry/list') return structuredClone(registry.entities);
      if (input.type === 'config/device_registry/list') return structuredClone(registry.devices);
      if (input.type === 'config/entity_registry/get_entries')
        return Object.fromEntries(
          (input.entity_ids as string[]).map((id) => [
            id,
            structuredClone(registry.entities.find((e) => e.entity_id === id) ?? null),
          ]),
        );
      if (input.type === 'config/entity_registry/get')
        return structuredClone(registry.entities.find((e) => e.entity_id === input.entity_id));
      writes.push(structuredClone(input));
      if (input.type === 'config_entries/disable') {
        Object.assign(
          registry.entries.find((e) => e.entry_id === input.entry_id)!,
          { disabled_by: input.disabled_by },
        );
        return true;
      }
      if (input.type === 'config/device_registry/update') {
        const { type: _type, device_id, ...patch } = input;
        Object.assign(
          registry.devices.find((d) => d.id === device_id)!,
          patch,
        );
        return {};
      }
      if (input.type === 'config/entity_registry/update') {
        const { type: _type, entity_id, new_entity_id, ...patch } = input as {
          type: string;
          entity_id: string;
          new_entity_id?: string;
          categories?: Record<string, string | null>;
          [key: string]: unknown;
        };
        assert.ok(
          !new_entity_id ||
            !registry.entities.some(
              (e) => e.entity_id === new_entity_id && e.entity_id !== entity_id,
            ),
        );
        const e = registry.entities.find((item) => item.entity_id === entity_id);
        assert.ok(e);
        Object.assign(e, patch, { entity_id: new_entity_id ?? entity_id });
        if (patch.categories)
          e.categories = Object.fromEntries(
            Object.entries(patch.categories).filter((pair): pair is [string, string] => pair[1] !== null),
          );
        if (failAfterRename) {
          failAfterRename = false;
          throw Error('lost_ack');
        }
        return structuredClone(e);
      }
      throw Error('Unexpected HA mutation');
    },
  };
  const serial = new Map<string, Promise<unknown>>();
  let owned = false;
  const native: NativeMigrationOptions['native'] = {
    serial,
    transaction: <T>(id: string, action: () => Promise<T> | T): Promise<T> => {
      const task = (serial.get(id) ?? Promise.resolve()).then(action);
      serial.set(
        id,
        task.catch(() => {}),
      );
      return task;
    },
    readyClient: () => ({ client_id: 'client' }),
    ownsActivity: () => owned,
    supportsDisabledReadiness: () => true,
    devices: () => [
      {
        bridgeId: 'bridge',
        cameraId: 'camera.one',
        entities: [
          { id: 'spotlight', domain: 'light' },
          { id: 'haus_activity', domain: 'binary_sensor' },
        ],
      },
    ],
    handoverStatus: () => ({
      state: owned ? 'connected' : 'migration_required',
      cameras: [
        {
          legacyEntities: registry.entities
            .filter((e) => e.platform === 'mqtt' || e.platform === 'generic')
            .map((e) => e.entity_id),
        },
      ],
    }),
  };
  const sources: NativeSourcesLike = {
    rows: () => [
      {
        bridgeId: 'bridge',
        physicalId: 'physical',
        value: { cameraId: 'camera.one', name: 'Camera', deviceIds: ['physical-device'] },
      },
    ],
  };
  const options: NativeMigrationOptions = {
    catalog: owner.haCatalog,
    ha,
    native,
    providers: {
      inventory: () => ({
        reachable: true,
        revision: 'a'.repeat(64),
        provider: 'aqara',
        cameras: [{ id: 'physical', identifiers: ['serial'] }],
      }),
    },
    sources,
    documents: async () => structuredClone(refs),
  };
  const migration = new NativeMigration(options);
  await migration.ready;
  sources.migrationIdentity = () => registry.entities.find((e) => e.id === 'old-camera');
  return {
    store,
    eventId: created.id,
    registry,
    writes,
    refs,
    options,
    migration,
    setOwned: (v: boolean) => (owned = v),
    loseAck: () => {
      failAfterRename = true;
    },
  };
}
type MigrationFixture = Awaited<ReturnType<typeof fixture>>;
async function apply(f: MigrationFixture) {
  const review = await f.migration.review('bridge');
  f.migration.start('bridge', { revision: review.revision, retire: review.retirements });
  await f.migration.running.get('bridge');
  return review;
}
test('review makes no changes; explicit transfer preserves canonical IDs, preferences and originals with pre-handover undo', async () => {
  const f = await fixture(),
    before = structuredClone(f.registry);
  const review = await f.migration.review('bridge');
  assert.equal(f.writes.length, 0);
  assert.deepEqual(review.blockers, []);
  assert.equal(review.replacements.length, 2);
  assert.deepEqual(review.retirements, ['sensor.stream']);
  assert.equal(JSON.stringify(review).includes('http://'), false);
  assert.throws(
    () => f.migration.start('bridge', { revision: review.revision, retire: [] }),
    /review_required/,
  );
  await apply(f);
  assert.equal(f.migration.status('bridge')!.phase, 'migrated');
  const next = f.registry.entities.find((e) => e.entity_id === 'camera.one')!;
  assert.equal(next.id, 'native-camera');
  assert.equal(next.name, 'My camera');
  assert.deepEqual(next.aliases, ['Porch']);
  assert.equal(f.registry.entities.find((e) => e.entity_id === 'light.porch')!.disabled_by, 'user');
  assert.equal(f.registry.devices.find((d) => d.id === 'native-device')!.area_id, 'garden');
  assert.equal(f.migration.ignoredLegacy('bridge', f.registry).size, 3);
  assert.equal((await f.store.get(f.eventId))!.bytes, 100);
  assert.deepEqual((await f.store.overrides())['camera.one'], { keep: true });
  f.migration.start('bridge', { revision: review.revision }, true);
  await f.migration.running.get('bridge');
  assert.equal(f.migration.status('bridge')!.phase, 'undone');
  assert.deepEqual(f.registry, before);
  assert.ok(f.writes.every((w) => !String(w.type).includes('call_service')));
});
test('saved device/internal/temporary/unmatched references and ambiguous physical identity block automatic transfer', async () => {
  const f = await fixture();
  for (const id of ['physical-device', 'old-light', 'camera.one_2', 'sensor.stream']) {
    f.refs.splice(0, f.refs.length, { label: 'automation.garden', config: { target: id } });
    const review = await f.migration.review('bridge');
    assert.ok(review.blockers.length);
    assert.deepEqual(review.references, ['automation.garden']);
    assert.throws(
      () => f.migration.start('bridge', { revision: review.revision, retire: review.retirements }),
      /review_required/,
    );
  }
  f.refs[0] = { label: 'automation.garden', config: { entity_id: 'light.porch' } };
  assert.deepEqual(
    (await f.migration.review('bridge')).blockers,
    [],
    'Preserved public IDs keep existing entity-based automations valid',
  );
  f.registry.devices.push({ id: 'ambiguous', identifiers: [['mqtt', 'serial']] });
  f.options.sources.rows = () => [
    {
      bridgeId: 'bridge',
      physicalId: 'physical',
      value: { cameraId: 'camera.one', name: 'Camera', deviceIds: [] },
    },
  ];
  assert.ok((await f.migration.review('bridge')).blockers.length);
  assert.equal(f.writes.length, 0);
});
test('concurrent user edits invalidate review before any metadata write', async () => {
  const f = await fixture(),
    review = await f.migration.review('bridge');
  f.registry.entities[0]!.name = 'Changed elsewhere';
  f.migration.start('bridge', { revision: review.revision, retire: review.retirements });
  await f.migration.running.get('bridge');
  assert.equal(f.writes.length, 0);
  assert.equal(f.migration.status('bridge')!.error, 'migration_review_changed');
});
test('a lost write acknowledgement rolls back actual HA facts instead of replaying renames', async () => {
  const f = await fixture(),
    before = structuredClone(f.registry);
  f.loseAck();
  await apply(f);
  assert.equal(f.migration.status('bridge')!.phase, 'undone');
  assert.deepEqual(f.registry, before);
});
test('restart keeps an interrupted journal; undo preserves later user edits and finalization fences rollback', async () => {
  const f = await fixture(),
    review = await apply(f);
  const record = f.migration.get('bridge')!;
  await f.migration.save('bridge', { ...record, phase: 'applying' });
  const resumed = new NativeMigration(f.options);
  await resumed.ready;
  assert.equal(resumed.status('bridge')!.phase, 'interrupted');
  await assert.rejects(async () => await resumed.handoverStarted('bridge'), /recovery_required/);
  f.registry.entities.find((e) => e.entity_id === 'camera.one')!.name = 'User edit';
  resumed.start('bridge', { revision: review.revision }, true);
  await resumed.running.get('bridge');
  assert.equal(resumed.status('bridge')!.phase, 'needs_attention');
  assert.equal(f.registry.entities.find((e) => e.id === 'native-camera')!.name, 'User edit');
  await resumed.save('bridge', record);
  await resumed.handoverStarted('bridge');
  assert.equal(resumed.status('bridge')!.phase, 'commit_pending');
  assert.throws(() => resumed.start('bridge', { revision: review.revision }, true), /not_ready/);
  await resumed.handoverFinished('bridge');
  f.setOwned(false);
  assert.equal(resumed.status('bridge')!.phase, 'committed');
  assert.throws(() => resumed.start('bridge', { revision: review.revision }, true), /not_ready/);
});
test('reference scanning is bounded, read-only and fails closed instead of hiding unknown configurations', async () => {
  const calls: string[] = [];
  const ha = {
    request: async (input: Record<string, unknown>): Promise<unknown> => {
      calls.push(String(input.type));
      if (input.type === 'lovelace/dashboards/list') return [];
      if (input.type === 'lovelace/config') throw Error('config_not_found');
      return { config: { entity_id: 'light.porch' } };
    },
  };
  assert.deepEqual(
    await nativeMigrationDocuments(ha, {
      states: [{ entity_id: 'automation.garden' }],
      entities: [],
    }),
    [{ label: 'automation.garden', config: { entity_id: 'light.porch' } }],
  );
  assert.ok(calls.every((c) => !c.includes('save')));
  assert.deepEqual(
    await nativeMigrationDocuments(ha, {
      states: [],
      entities: [{ entity_id: 'automation.disabled' }],
    }),
    [{ label: 'automation.disabled', config: { entity_id: 'light.porch' } }],
  );
  ha.request = async () => {
    throw Error('offline');
  };
  await assert.rejects(nativeMigrationDocuments(ha, { states: [], entities: [] }), /offline/);
});
test('disabled preferences require negotiated readiness; newly saved references block final retirement', async () => {
  const f = await fixture();
  f.options.native.supportsDisabledReadiness = () => false;
  assert.ok((await f.migration.review('bridge')).blockers.some((item) => item.includes('Update')));
  f.options.native.supportsDisabledReadiness = () => true;
  await apply(f);
  f.refs.push({ label: 'automation.new', config: { device_id: 'physical-device' } });
  await assert.rejects(f.migration.beforeHandover('bridge'), /references_changed/);
  assert.equal(
    f.migration.status('bridge')!.phase,
    'migrated',
    'No publication change was attempted',
  );
  assert.deepEqual(f.migration.status('bridge')!.references, ['automation.new']);
  f.refs.length = 0;
  await f.migration.beforeHandover('bridge');
  f.registry.entities.find((e) => e.id === 'old-light')!.disabled_by = null;
  await assert.rejects(f.migration.beforeHandover('bridge'), /registry_changed/);
});
test('a queued undo cannot cross the durable finalization fence after an uncertain provider acknowledgement', async () => {
  const f = await fixture(),
    review = await apply(f);
  let finish!: () => void, entered!: () => void;
  const started = new Promise<void>((r) => {
    entered = r;
  });
  const blocked = new Promise<void>((r) => {
    finish = r;
  });
  const handover = f.options.native.transaction('bridge', async () => {
    entered();
    await blocked;
    await f.migration.handoverStarted('bridge');
  });
  await started;
  f.migration.start('bridge', { revision: review.revision }, true);
  finish();
  await handover;
  await f.migration.running.get('bridge');
  assert.equal(f.migration.status('bridge')!.phase, 'commit_pending');
  assert.equal(f.registry.entities.find((e) => e.id === 'native-camera')!.entity_id, 'camera.one');
});
