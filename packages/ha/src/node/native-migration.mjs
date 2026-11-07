/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import {
  fingerprint,
  planMigration,
  preferences,
  publicMigration,
  referenceConflicts,
  sameEntity,
  stable,
} from '@haus/bridge/migration';
import { activityKey } from './activity.mjs';

/** Only explicit admin requests change HA metadata; journals survive an interrupted request/restart. */
export class NativeMigration {
  constructor({
    catalog,
    ha,
    providers,
    sources,
    native,
    documents,
    onChanged = () => {},
    now = Date.now,
  }) {
    Object.assign(this, { catalog, ha, providers, sources, native, documents, onChanged, now });
    this.running = new Map();
    this.closed = false;
    this.ready = this.initialize();
  }
  async initialize() {
    for (const row of this.catalog.journalRows()) {
      const record = JSON.parse(row.value);
      if (['applying', 'undoing'].includes(record.phase))
        await this.save(row.bridgeId, { ...record, phase: 'interrupted' });
    }
  }
  get(id) {
    const value = this.catalog.journal(id);
    return value === undefined ? undefined : JSON.parse(value);
  }
  async save(id, record) {
    await this.catalog.saveJournal(id, JSON.stringify({ ...record, at: this.now() }));
    this.onChanged();
  }
  status(id) {
    const record = this.get(id);
    return record
      ? {
          ...publicMigration(record.plan),
          phase: record.phase,
          error: record.error,
          rollbackFailures: record.rollbackFailures ?? [],
        }
      : null;
  }
  async registry() {
    const registry = await this.ha.registry();
    registry.entries = await this.ha.request({ type: 'config_entries/get' });
    return registry;
  }
  async build(id) {
    if (this.closed) throw Error('migration_stopping');
    const inventory = this.providers.inventory(id);
    if (!inventory.reachable) throw Error('native_provider_unavailable');
    const registry = await this.registry();
    const rows = this.sources.rows().filter((row) => row.bridgeId === id);
    const descriptors = this.native.devices().filter((device) => device.bridgeId === id);
    const cameras = inventory.cameras.map((physical) => {
      const row = rows.find((row) => row.physicalId === physical.id);
      const descriptor = descriptors.find((item) => item.cameraId === row?.value.cameraId);
      if (!row || !descriptor || !this.native.readyClient(row.value.cameraId, inventory.revision))
        throw Error('native_ha_not_ready');
      return {
        cameraId: row.value.cameraId,
        physicalId: physical.id,
        identifiers: physical.identifiers,
        name: row.value.name,
        deviceIds: [
          ...new Set([row.value.deviceId, ...(row.value.deviceIds ?? [])].filter(Boolean)),
        ],
        activityKey: activityKey(row.value.cameraId),
        legacyCamera: this.sources.migrationIdentity?.(id, physical.id, registry),
        entities: descriptor.entities.map(({ id, domain }) => ({ id, domain })),
      };
    });
    if (!cameras.length) throw Error('native_ha_not_ready');
    const physicalDevices = new Set(
      registry.devices
        .filter((device) =>
          device.identifiers?.some(
            ([platform, value]) =>
              ['mqtt', inventory.provider].includes(platform) &&
              cameras.some((camera) => camera.identifiers.includes(value)),
          ),
        )
        .map((device) => device.id),
    );
    const selected = registry.entities.filter(
      (entity) =>
        entity.platform === 'haus' ||
        physicalDevices.has(entity.device_id) ||
        cameras.some(
          (camera) =>
            camera.cameraId === entity.entity_id ||
            camera.deviceIds.includes(entity.device_id) ||
            entity.unique_id === camera.activityKey,
        ),
    );
    // The lightweight list omits aliases/options. Fetch the supported extended registry view.
    for (let offset = 0; offset < selected.length; offset += 256) {
      const entries = await this.ha.request({
        type: 'config/entity_registry/get_entries',
        entity_ids: selected.slice(offset, offset + 256).map((entity) => entity.entity_id),
      });
      for (const [key, value] of Object.entries(entries)) {
        const index = registry.entities.findIndex((entity) => entity.entity_id === key);
        if (!value || index < 0) throw Error('migration_registry_changed');
        registry.entities[index] = value;
      }
    }
    let documents = [],
      scanIncomplete = false;
    try {
      documents = await this.documents(registry);
    } catch {
      scanIncomplete = true;
    }
    if (this.closed) throw Error('migration_stopping');
    const plan = planMigration({
      bridgeId: id,
      provider: inventory.provider,
      providerRevision: inventory.revision,
      registry,
      cameras,
      documents,
    });
    const accounted = new Set(plan.moves.map((move) => move.legacy.entity_id));
    if (scanIncomplete)
      plan.blockers.push(
        'Home Assistant could not read every saved automation, script, scene and dashboard. Restore access or review unsupported configurations before transferring.',
      );
    for (const camera of this.native.handoverStatus(id, registry).cameras)
      for (const entity of camera.legacyEntities)
        if (!accounted.has(entity)) plan.blockers.push(`Legacy identity needs review: ${entity}`);
    if (
      plan.moves.some((move) => move.native && move.preferences.disabled_by === 'user') &&
      cameras.some(
        (camera) => !this.native.supportsDisabledReadiness(camera.cameraId, inventory.revision),
      )
    )
      plan.blockers.push(
        'Update the Haus Home Assistant integration to preserve disabled controls',
      );
    plan.revision = fingerprint(plan);
    return plan;
  }
  async review(id) {
    return this.native.transaction(id, async () => {
      const existing = this.get(id);
      if (existing && !['review', 'undone'].includes(existing.phase)) return this.status(id);
      if (this.native.handoverStatus(id, await this.registry()).state === 'connected')
        throw Error('native_already_connected');
      const plan = await this.build(id);
      await this.save(id, { phase: 'review', plan });
      return this.status(id);
    });
  }
  start(id, input, undo = false) {
    if (this.closed) throw Error('migration_stopping');
    if (
      !input ||
      typeof input.revision !== 'string' ||
      !/^[a-f0-9]{64}$/.test(input.revision) ||
      Object.keys(input).sort().join(',') !== (undo ? 'revision' : 'retire,revision') ||
      (!undo &&
        (!Array.isArray(input.retire) ||
          input.retire.length > 512 ||
          input.retire.some((value) => typeof value !== 'string')))
    )
      throw Error('invalid_native_migration');
    const record = this.get(id);
    if (!record || record.plan.revision !== input.revision) throw Error('migration_review_changed');
    if (record.plan.cameraIds.some((cameraId) => this.native.ownsActivity(cameraId)))
      throw Error('migration_already_committed');
    if (this.running.has(id)) return this.status(id);
    if (
      undo
        ? !['migrated', 'interrupted', 'needs_attention'].includes(record.phase)
        : record.phase !== 'review'
    )
      throw Error('migration_not_ready');
    if (
      !undo &&
      (record.plan.blockers.length ||
        stable([...input.retire].sort()) !==
          stable(
            record.plan.moves
              .filter((move) => !move.native)
              .map((move) => move.legacy.entity_id)
              .sort(),
          ))
    )
      throw Error('migration_review_required');
    const job = this.native
      .transaction(id, async () => {
        const latest = this.get(id);
        if (
          !latest ||
          latest.plan.revision !== record.plan.revision ||
          (undo
            ? !['migrated', 'interrupted', 'needs_attention'].includes(latest.phase)
            : latest.phase !== 'review')
        )
          throw Error('migration_not_ready');
        if (undo) return this.undo(id, latest);
        const current = await this.build(id);
        if (current.revision !== record.plan.revision) throw Error('migration_review_changed');
        await this.save(id, { ...record, phase: 'applying' });
        try {
          for (const entry of record.plan.entries) await this.entry(entry, false);
          for (const move of record.plan.moves) {
            await this.rename(move.legacy, move.legacy.entity_id, move.parked, {
              hidden_by: 'user',
              disabled_by: 'user',
            });
            if (move.native)
              await this.rename(
                move.native,
                move.native.entity_id,
                move.legacy.entity_id,
                move.preferences,
              );
          }
          for (const device of record.plan.devices) await this.device(device, false);
          await this.verify(record.plan, true);
          await this.save(id, { ...record, phase: 'migrated' });
        } catch {
          if (this.closed) await this.save(id, { ...record, phase: 'interrupted' });
          else await this.undo(id, { ...record, phase: 'applying' }, true);
        }
      })
      .catch(async () => {
        const latest = this.get(id);
        if (latest?.phase === 'review')
          await this.save(id, { ...latest, error: 'migration_review_changed' });
        else if (latest && ['applying', 'undoing'].includes(latest.phase))
          await this.save(id, {
            ...latest,
            phase: 'needs_attention',
            error: 'migration_interrupted',
          });
      })
      .finally(() => this.running.delete(id));
    this.running.set(id, job);
    return { ...this.status(id), phase: undo ? 'undoing' : 'applying' };
  }
  async rename(expected, from, to, patch, expectedPreferences = preferences(expected)) {
    if (this.closed) throw Error('migration_stopping');
    const all = await this.ha.request({
      type: 'config/entity_registry/get_entries',
      entity_ids: [...new Set([from, to])],
    });
    if (!sameEntity(all[from], expected) || (from !== to && all[to]))
      throw Error('migration_registry_changed');
    if (stable(preferences(all[from])) !== stable(expectedPreferences))
      throw Error('migration_user_edit');
    if (this.closed) throw Error('migration_stopping');
    const changes = { ...patch };
    if (patch.categories)
      changes.categories = {
        ...Object.fromEntries(Object.keys(all[from].categories ?? {}).map((key) => [key, null])),
        ...patch.categories,
      };
    await this.ha.request({
      type: 'config/entity_registry/update',
      entity_id: from,
      new_entity_id: to,
      ...changes,
    });
  }
  async device(device, undo) {
    if (this.closed) throw Error('migration_stopping');
    const all = await this.ha.request({ type: 'config/device_registry/list' });
    const current = all.find((item) => item.id === device.before.id);
    if (!current) throw Error('migration_device_changed');
    const before = {
      name_by_user: device.before.name_by_user ?? null,
      area_id: device.before.area_id ?? null,
      labels: [...(device.before.labels ?? [])].sort(),
    };
    const facts = {
      name_by_user: current.name_by_user ?? null,
      area_id: current.area_id ?? null,
      labels: [...(current.labels ?? [])].sort(),
    };
    const source = undo ? device.preferences : before,
      target = undo ? before : device.preferences;
    if (stable(facts) === stable(target)) return;
    if (stable(facts) !== stable(source)) throw Error('migration_device_changed');
    if (this.closed) throw Error('migration_stopping');
    await this.ha.request({
      type: 'config/device_registry/update',
      device_id: current.id,
      ...target,
    });
  }
  async entry(entry, undo) {
    if (this.closed) throw Error('migration_stopping');
    const entries = await this.ha.request({ type: 'config_entries/get' });
    const current = entries.find((item) => item.entry_id === entry.entry_id);
    const source = undo ? 'user' : entry.disabled_by,
      target = undo ? entry.disabled_by : 'user';
    if (!current || current.domain !== 'generic') throw Error('migration_entry_changed');
    if ((current.disabled_by ?? null) === target) return;
    if ((current.disabled_by ?? null) !== source || this.closed)
      throw Error('migration_entry_changed');
    await this.ha.request({
      type: 'config_entries/disable',
      entry_id: entry.entry_id,
      disabled_by: target,
    });
  }
  async verify(plan, exactPreferences = false) {
    const registry = await this.registry();
    const ids = plan.moves.flatMap((move) => [
      move.parked,
      ...(move.native ? [move.legacy.entity_id] : []),
    ]);
    for (let offset = 0; offset < ids.length; offset += 256) {
      const entries = await this.ha.request({
        type: 'config/entity_registry/get_entries',
        entity_ids: ids.slice(offset, offset + 256),
      });
      for (const move of plan.moves) {
        if (!Object.hasOwn(entries, move.parked)) continue;
        const parked = entries[move.parked];
        if (
          !sameEntity(parked, move.legacy) ||
          parked.disabled_by !== 'user' ||
          parked.hidden_by !== 'user'
        )
          throw Error('migration_registry_changed');
      }
      for (const move of plan.moves.filter(
        (move) => move.native && Object.hasOwn(entries, move.legacy.entity_id),
      )) {
        const current = entries[move.legacy.entity_id];
        if (
          !sameEntity(current, move.native) ||
          (exactPreferences && stable(preferences(current)) !== stable(move.preferences))
        )
          throw Error('migration_registry_changed');
      }
    }
    if (
      plan.entries.some(
        (entry) =>
          !registry.entries.some(
            (item) =>
              item.entry_id === entry.entry_id &&
              item.domain === 'generic' &&
              item.disabled_by === 'user',
          ),
      )
    )
      throw Error('migration_entry_changed');
    if (
      exactPreferences &&
      plan.devices.some((device) => {
        const current = registry.devices.find((item) => item.id === device.before.id);
        return (
          !current ||
          stable({
            name_by_user: current.name_by_user ?? null,
            area_id: current.area_id ?? null,
            labels: [...(current.labels ?? [])].sort(),
          }) !== stable(device.preferences)
        );
      })
    )
      throw Error('migration_device_changed');
    return registry;
  }
  /** Recheck newly saved references before the irreversible MQTT retirement, inside the bridge queue. */
  async beforeHandover(id) {
    const record = this.get(id);
    if (!record || record.phase === 'committed') return;
    if (!['migrated', 'commit_pending'].includes(record.phase))
      throw Error('migration_recovery_required');
    const registry = await this.verify(record.plan);
    const documents = await this.documents(registry);
    const references = referenceConflicts(documents, [
      ...record.plan.protectedIds,
      ...record.plan.moves.map((move) => move.parked),
    ]);
    if (references.length) {
      await this.save(id, {
        ...record,
        plan: { ...record.plan, references },
        error: 'migration_references_changed',
      });
      throw Error('migration_references_changed');
    }
    if (this.closed) throw Error('migration_stopping');
  }
  async undo(id, record, automatic = false) {
    if (record.plan.cameraIds.some((cameraId) => this.native.ownsActivity(cameraId)))
      throw Error('migration_already_committed');
    await this.save(id, { ...record, phase: 'undoing' });
    const failures = [];
    for (const device of [...record.plan.devices].reverse()) {
      try {
        await this.device(device, true);
      } catch {
        failures.push('Device preferences');
      }
    }
    for (const move of [...record.plan.moves].reverse()) {
      if (this.closed) {
        await this.save(id, { ...record, phase: 'interrupted' });
        return;
      }
      try {
        const all = await this.ha.request({ type: 'config/entity_registry/list' });
        const native = move.native && all.find((entity) => entity.id === move.native.id);
        const old = all.find((entity) => entity.id === move.legacy.id);
        if (move.native && native?.entity_id === move.legacy.entity_id) {
          const full = await this.ha.request({
            type: 'config/entity_registry/get',
            entity_id: native.entity_id,
          });
          if (stable(preferences(full)) !== stable(move.preferences))
            throw Error('migration_user_edit');
          await this.rename(
            move.native,
            native.entity_id,
            move.native.entity_id,
            preferences(move.native),
            preferences(full),
          );
        } else if (
          move.native &&
          (!sameEntity(native, move.native) || native.entity_id !== move.native.entity_id)
        )
          throw Error('migration_native_changed');
        if (old?.entity_id === move.parked) {
          const full = await this.ha.request({
            type: 'config/entity_registry/get',
            entity_id: old.entity_id,
          });
          if (
            stable(preferences(full)) !==
            stable({ ...preferences(move.legacy), hidden_by: 'user', disabled_by: 'user' })
          )
            throw Error('migration_user_edit');
          await this.rename(
            move.legacy,
            move.parked,
            move.legacy.entity_id,
            preferences(move.legacy),
            preferences(full),
          );
        } else if (!sameEntity(old, move.legacy) || old.entity_id !== move.legacy.entity_id)
          throw Error('migration_legacy_changed');
      } catch {
        failures.push(move.legacy.entity_id);
      }
    }
    if (!failures.length)
      for (const entry of record.plan.entries) {
        try {
          await this.entry(entry, true);
        } catch {
          failures.push('Camera integration');
        }
      }
    await this.save(id, {
      ...record,
      phase: failures.length ? 'needs_attention' : 'undone',
      error: automatic ? 'migration_reverted' : undefined,
      rollbackFailures: [...new Set(failures)],
    });
  }
  ignoredLegacy(id, registry) {
    const record = this.get(id);
    if (!record || !['migrated', 'commit_pending'].includes(record.phase)) return new Set();
    for (const move of record.plan.moves) {
      const legacy = registry.entities.find((entity) => entity.entity_id === move.parked);
      if (!sameEntity(legacy, move.legacy) || legacy.disabled_by !== 'user') return new Set();
      if (
        move.native &&
        !sameEntity(
          registry.entities.find((entity) => entity.entity_id === move.legacy.entity_id),
          move.native,
        )
      )
        return new Set();
    }
    return new Set(record.plan.moves.map((move) => move.parked));
  }
  async handoverStarted(id) {
    const record = this.get(id);
    if (!record) return;
    if (['applying', 'undoing', 'interrupted', 'needs_attention'].includes(record.phase))
      throw Error('migration_recovery_required');
    if (record.phase === 'migrated') await this.save(id, { ...record, phase: 'commit_pending' });
  }
  async handoverFinished(id) {
    const record = this.get(id);
    if (record?.phase === 'commit_pending') await this.save(id, { ...record, phase: 'committed' });
  }
  async stop() {
    this.closed = true;
    await Promise.allSettled([...(this.native.serial?.values() ?? []), ...this.running.values()]);
  }
}
