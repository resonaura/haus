/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Box, FileInput, HausButton as Button, HausModalOverlay as Modal, Text } from '@haus/ui';
import { useRef, useState } from 'react';

export interface HaImportEntry {
  readonly entry: {
    readonly entryId: string;
    readonly domain: string;
    readonly title: string;
    readonly data: Record<string, unknown>;
    readonly options?: Record<string, unknown>;
    readonly uniqueId?: string | null;
    readonly version?: number;
    readonly minorVersion?: number;
    readonly disabledBy: 'user';
    readonly subentries?: readonly {
      readonly subentryId: string;
      readonly subentryType: string;
      readonly title: string;
      readonly data: Record<string, unknown>;
      readonly uniqueId?: string | null;
    }[];
  };
  readonly entities?: readonly Record<string, unknown>[];
  readonly devices?: readonly Record<string, unknown>[];
  readonly areas?: readonly { readonly id: string; readonly name: string }[];
}

interface HaImportSummary {
  readonly id: string;
  readonly domain: string;
  readonly title: string;
  readonly devices: number;
  readonly entities: number;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function records(value: unknown, label: string): Record<string, unknown>[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`The ${label} list is invalid.`);
  return value.map((item) => {
    const parsed = record(item);
    if (!parsed) throw new Error(`The ${label} list is invalid.`);
    return parsed;
  });
}

function parseEntry(value: unknown): HaImportEntry {
  const source = record(value);
  const entry = record(source?.entry);
  const data = record(entry?.data);
  const options = entry?.options === undefined ? undefined : record(entry.options);
  const rawSubentries = entry?.subentries;
  if (
    rawSubentries !== undefined &&
    (!Array.isArray(rawSubentries) || rawSubentries.length > 100)
  ) {
    throw new Error('The integration subentries are invalid.');
  }
  const subentryIds = new Set<string>();
  const subentryUniqueIds = new Set<string>();
  const subentries = rawSubentries?.map((value) => {
    const subentry = record(value);
    const subentryData = record(subentry?.data);
    if (
      !subentry ||
      typeof subentry.subentryId !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(subentry.subentryId) ||
      subentryIds.has(subentry.subentryId) ||
      typeof subentry.subentryType !== 'string' ||
      !/^[a-z0-9_]{1,128}$/.test(subentry.subentryType) ||
      typeof subentry.title !== 'string' ||
      !subentry.title.trim() ||
      subentry.title.length > 256 ||
      !subentryData ||
      (subentry.uniqueId !== undefined &&
        subentry.uniqueId !== null &&
        (typeof subentry.uniqueId !== 'string' ||
          subentry.uniqueId.length > 1024 ||
          subentryUniqueIds.has(subentry.uniqueId)))
    ) {
      throw new Error('The integration subentries are invalid.');
    }
    subentryIds.add(subentry.subentryId);
    if (typeof subentry.uniqueId === 'string') subentryUniqueIds.add(subentry.uniqueId);
    return {
      subentryId: subentry.subentryId,
      subentryType: subentry.subentryType,
      title: subentry.title,
      data: subentryData,
      ...(typeof subentry.uniqueId === 'string' || subentry.uniqueId === null
        ? { uniqueId: subentry.uniqueId }
        : {}),
    };
  });
  if (
    !entry ||
    typeof entry.entryId !== 'string' ||
    typeof entry.domain !== 'string' ||
    !/^[a-z0-9_]{1,128}$/.test(entry.domain) ||
    typeof entry.title !== 'string' ||
    !data ||
    (entry.options !== undefined && !options) ||
    entry.disabledBy !== 'user'
  ) {
    throw new Error('This file is not a supported, disabled Home Assistant transfer bundle.');
  }

  const entities = records(source?.entities, 'entity');
  if (
    entities.some(
      (entity) =>
        entity.config_subentry_id !== undefined &&
        entity.config_subentry_id !== null &&
        (typeof entity.config_subentry_id !== 'string' ||
          !subentryIds.has(entity.config_subentry_id)),
    )
  ) {
    throw new Error('An entity refers to an integration subentry that is missing.');
  }
  const devices = records(source?.devices, 'device');
  if (
    devices.some(
      (device) =>
        device.config_subentry_id !== undefined &&
        device.config_subentry_id !== null &&
        (typeof device.config_subentry_id !== 'string' ||
          !subentryIds.has(device.config_subentry_id)),
    )
  ) {
    throw new Error('A device refers to an integration subentry that is missing.');
  }
  const areaRows = records(source?.areas, 'area');
  const areas = areaRows.map((area) => {
    if (typeof area.id !== 'string' || typeof area.name !== 'string') {
      throw new Error('The area list is invalid.');
    }
    return { id: area.id, name: area.name };
  });
  const uniqueId = entry.uniqueId;
  const version = entry.version;
  const minorVersion = entry.minorVersion;
  if (
    (uniqueId !== undefined && uniqueId !== null && typeof uniqueId !== 'string') ||
    (version !== undefined && typeof version !== 'number') ||
    (minorVersion !== undefined && typeof minorVersion !== 'number')
  ) {
    throw new Error('The integration metadata is invalid.');
  }

  return {
    entry: {
      entryId: entry.entryId,
      domain: entry.domain,
      title: entry.title,
      data,
      ...(options ? { options } : {}),
      ...(typeof uniqueId === 'string' || uniqueId === null ? { uniqueId } : {}),
      ...(typeof version === 'number' ? { version } : {}),
      ...(typeof minorVersion === 'number' ? { minorVersion } : {}),
      ...(subentries !== undefined ? { subentries } : {}),
      disabledBy: 'user',
    },
    ...(entities.length ? { entities } : {}),
    ...(devices.length ? { devices } : {}),
    ...(areas.length ? { areas } : {}),
  };
}

async function readBundle(file: File): Promise<HaImportEntry[]> {
  if (file.size > 80 * 1024) throw new Error('The transfer file exceeds 80 KB.');
  const parsed: unknown = JSON.parse(await file.text());
  const bundle = record(parsed);
  if (!bundle || !Array.isArray(bundle.entries) || bundle.entries.length === 0) {
    throw new Error('Choose a Home Assistant transfer JSON file.');
  }
  return bundle.entries.map(parseEntry);
}

function describeImportFailure(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : '';
  if (message.includes('integration_entry_identity_conflict')) {
    return 'This physical integration already has an owner on Miku. The HA copy was left active.';
  }
  if (message.includes('integration_entity_conflict')) {
    return 'One or more entity IDs are already owned on Miku. Haus did not switch ownership; HA remains active.';
  }
  if (message.includes('integration_entry_conflict')) {
    return 'Miku already has a different copy of this integration entry. The HA copy was left active.';
  }
  if (message.includes('ha_flow_runtime_unavailable')) {
    return 'Miku could not start the integration runtime. HA remains active.';
  }
  if (message.includes('unsupported_import_domain')) {
    return 'Miku does not support this Home Assistant integration. The HA copy was left active.';
  }
  return message || 'Import stopped before completion.';
}

export function HaImportDialog({
  busy,
  onClose,
  onImport,
  onComplete,
  formatDomain,
}: {
  busy: boolean;
  onClose: () => void;
  onImport: (entry: HaImportEntry) => Promise<unknown>;
  onComplete: () => void;
  formatDomain: (domain: string) => string;
}) {
  const payloads = useRef<HaImportEntry[]>([]);
  const [entries, setEntries] = useState<HaImportSummary[]>([]);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [importStarted, setImportStarted] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [complete, setComplete] = useState(false);

  const chooseFile = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    payloads.current = [];
    setEntries([]);
    setCompleted(0);
    setImportStarted(false);
    setComplete(false);
    try {
      const parsed = await readBundle(file);
      payloads.current = parsed;
      setEntries(
        parsed.map((item) => ({
          id: item.entry.entryId,
          domain: item.entry.domain,
          title: item.entry.title,
          devices: item.devices?.length ?? 0,
          entities: item.entities?.length ?? 0,
        })),
      );
      setFileName(file.name);
    } catch (cause) {
      setFileName('');
      setError(cause instanceof Error ? cause.message : 'Could not read this file.');
    }
  };

  const importEntries = async () => {
    if (importing || entries.length === 0) return;
    setImporting(true);
    setImportStarted(true);
    setError('');
    let imported = 0;
    try {
      for (let index = 0; index < entries.length; index += 1) {
        const item = payloads.current[index];
        if (!item) throw new Error('The selected transfer data is no longer available.');
        await onImport(item);
        imported = index + 1;
        setCompleted(imported);
      }
      payloads.current = [];
      setComplete(true);
      onComplete();
    } catch (cause) {
      if (imported > 0) onComplete();
      setError(describeImportFailure(cause));
    } finally {
      setImporting(false);
    }
  };

  const percent = entries.length ? Math.round((completed / entries.length) * 100) : 0;
  const canClose = !busy && !importing;

  return (
    <Modal
      isOpen
      onOpenChange={(open) => {
        if (!open && canClose) onClose();
      }}
    >
      <Modal.Backdrop variant="blur">
        <Modal.Container>
          <Modal.Dialog className="haus-dialog">
            <Modal.CloseTrigger isDisabled={!canClose} />
            <Modal.Header>
              <Modal.Heading>Import Home Assistant data</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <Text semantic="p" className="flow-description">
                Selected Home Assistant entries can be staged from an export. Imported entries stay
                disabled until ownership is switched to Haus.
              </Text>
              <Text semantic="label" className="ha-import-file">
                <Text>Transfer file</Text>
                <FileInput
                  accept=".json,application/json"
                  disabled={importing || busy}
                  onFileChange={(file) => void chooseFile(file)}
                />
              </Text>
              {fileName && (
                <Text semantic="p" className="management-notice">
                  {fileName}
                </Text>
              )}
              {entries.length > 0 && (
                <Box className="ha-import-summary">
                  <Text semantic="strong">{entries.length} entries ready</Text>
                  <Box semantic="list">
                    {entries.map((item) => (
                      <Box semantic="listitem" key={item.id}>
                        {formatDomain(item.domain)} · {item.title} · {item.devices} devices ·{' '}
                        {item.entities} entities
                      </Box>
                    ))}
                  </Box>
                </Box>
              )}
              {(importing || complete || importStarted) && (
                <Box className="ha-import-progress">
                  <Box className="ha-import-progress-label">
                    <Text>
                      {complete
                        ? 'Staged'
                        : importing
                          ? `Staging ${completed} of ${entries.length}`
                          : `Stopped after ${completed} of ${entries.length}`}
                    </Text>
                    <Text>{percent}%</Text>
                  </Box>
                  <Box
                    className="ha-import-progress-track"
                    role="progressbar"
                    ariaLabel="Home Assistant import progress"
                    ariaValueMin={0}
                    ariaValueMax={100}
                    ariaValueNow={percent}
                  >
                    <Text surfaceTokens={{ width: `${percent}%` }} />
                  </Box>
                </Box>
              )}
              {error && (
                <Text semantic="p" role="alert" className="form-error">
                  {error}
                </Text>
              )}
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" isDisabled={!canClose} onPress={onClose}>
                {complete ? 'Close' : 'Cancel'}
              </Button>
              {!complete && (
                <Button
                  variant="primary"
                  isDisabled={busy || importing || entries.length === 0}
                  onPress={() => void importEntries()}
                >
                  {importing ? 'Importing…' : 'Stage entries'}
                </Button>
              )}
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
