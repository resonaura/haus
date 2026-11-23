/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useState } from 'react';
import {
  Box,
  corners,
  HausButton,
  HausCard,
  HausProgressBar,
  HausSwitch,
  insets,
  pct,
  px,
  rgba,
  Row,
  SolidMaterial,
  Stack,
  Text,
} from '@haus/ui';
import { getHomeTransport } from '../../../app/transport';
import {
  buildAction,
  resolveCapabilities,
  type HassEntity,
  type HausAccessory,
} from '../../../model';
import { findDeviceUpdateEntities, friendlyEntityLabel } from './entity-matchers';

type Action = ReturnType<typeof buildAction>;

export interface FirmwareUpdateCardProps {
  readonly entity: HassEntity;
  readonly deviceName?: string;
  readonly pending?: boolean;
  readonly onAction?: (action: Action) => void;
}

export function FirmwareUpdateCard({
  entity,
  deviceName,
  pending = false,
  onAction,
}: FirmwareUpdateCardProps) {
  const attrs = entity.attributes;
  const installedVersion =
    typeof attrs.installed_version === 'string' && attrs.installed_version
      ? attrs.installed_version
      : null;
  const latestVersion =
    typeof attrs.latest_version === 'string' && attrs.latest_version
      ? attrs.latest_version
      : installedVersion;
  const skippedVersion =
    typeof attrs.skipped_version === 'string' && attrs.skipped_version
      ? attrs.skipped_version
      : null;
  const releaseSummary =
    typeof attrs.release_summary === 'string' && attrs.release_summary.trim()
      ? attrs.release_summary.trim()
      : null;
  const releaseUrl =
    typeof attrs.release_url === 'string' && attrs.release_url.trim()
      ? attrs.release_url.trim()
      : null;

  const inProgressAttr = attrs.in_progress;
  const numericProgress =
    typeof attrs.update_percentage === 'number'
      ? attrs.update_percentage
      : typeof inProgressAttr === 'number'
        ? inProgressAttr
        : null;
  const inProgress = Boolean(inProgressAttr) || numericProgress !== null;
  const updateAvailable =
    entity.state === 'on' ||
    Boolean(
      installedVersion &&
      latestVersion &&
      installedVersion !== latestVersion &&
      latestVersion !== skippedVersion,
    );

  const capabilities = new Set(resolveCapabilities(entity, {}));
  const canInstall = capabilities.has('install') || capabilities.size === 0;
  const canBackup = capabilities.has('backup');
  const canReleaseNotes = capabilities.has('release-notes');

  const [createBackup, setCreateBackup] = useState(false);
  const [releaseNotes, setReleaseNotes] = useState<string | null>(null);
  const [notesLoading, setNotesLoading] = useState(false);
  const [notesExpanded, setNotesExpanded] = useState(false);

  useEffect(() => {
    if (!updateAvailable || !canReleaseNotes) return;
    let cancelled = false;
    setNotesLoading(true);
    void getHomeTransport()
      .request({
        type: 'update/release_notes',
        entity_id: entity.entity_id,
      })
      .then((res: unknown) => {
        if (cancelled) return;
        if (typeof res === 'string' && res.trim()) {
          setReleaseNotes(res.trim());
        } else if (
          res &&
          typeof res === 'object' &&
          'notes' in res &&
          typeof (res as { notes?: unknown }).notes === 'string'
        ) {
          setReleaseNotes(((res as { notes: string }).notes || '').trim() || null);
        }
      })
      .catch(() => {
        /* Fallback to release_summary if RPC is unsupported. */
      })
      .finally(() => {
        if (!cancelled) setNotesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canReleaseNotes, entity.entity_id, updateAvailable]);

  const title =
    typeof attrs.title === 'string' && attrs.title.trim()
      ? attrs.title.trim()
      : friendlyEntityLabel(entity, deviceName) || 'Firmware';

  const versionSubtitle =
    installedVersion && latestVersion && installedVersion !== latestVersion
      ? `${installedVersion} → ${latestVersion}`
      : (installedVersion ?? latestVersion ?? 'Current release');

  const badgeTone = inProgress
    ? ('accent' as const)
    : updateAvailable
      ? ('warning' as const)
      : skippedVersion
        ? ('default' as const)
        : ('success' as const);

  const badgeLabel = inProgress
    ? numericProgress !== null
      ? `Installing ${Math.round(numericProgress)}%`
      : 'Installing…'
    : updateAvailable
      ? 'Update available'
      : skippedVersion
        ? `Skipped ${skippedVersion}`
        : 'Up to date';

  const effectiveNotes = releaseNotes ?? releaseSummary;

  return (
    <HausCard
      title={title}
      subtitle={versionSubtitle}
      badge={{ label: badgeLabel, tone: badgeTone }}
      glass
    >
      <Stack gapPx={10}>
        {inProgress && (
          <HausProgressBar
            value={numericProgress ?? 50}
            label="Installing router firmware…"
            tone="accent"
          />
        )}

        {effectiveNotes && (
          <Box
            style={{
              layout: {
                maxHeight: px(notesExpanded ? 240 : 72),
                overflowY: 'auto',
                padding: insets(8, 10),
              },
              material: new SolidMaterial(rgba(128, 128, 128, 0.08)),
              corners: corners(10, 'superellipse', 1.4),
            }}
          >
            <Text
              size={12}
              tone="secondary"
              style={{ typography: { lineHeight: 1.48, whiteSpace: 'pre-wrap' } }}
            >
              {effectiveNotes}
            </Text>
          </Box>
        )}

        {(effectiveNotes && effectiveNotes.length > 140) || releaseUrl || notesLoading ? (
          <Row gapPx={8} wrap>
            {effectiveNotes && effectiveNotes.length > 140 && (
              <HausButton
                variant="ghost"
                size="sm"
                onPress={() => setNotesExpanded((prev) => !prev)}
              >
                {notesExpanded ? 'Show less' : 'Read full release notes'}
              </HausButton>
            )}
            {releaseUrl && (
              <HausButton
                variant="ghost"
                size="sm"
                onPress={() => {
                  if (window.hausNative) {
                    void window.hausNative.openExternal(releaseUrl);
                  } else {
                    window.open(releaseUrl, '_blank', 'noopener,noreferrer');
                  }
                }}
              >
                Release changelog ↗
              </HausButton>
            )}
            {notesLoading && (
              <Text tone="muted" size={11.5}>
                Loading notes…
              </Text>
            )}
          </Row>
        ) : null}

        {updateAvailable && canBackup && !inProgress && (
          <HausSwitch
            size="sm"
            isSelected={createBackup}
            label="Create automatic backup before installing"
            onChange={setCreateBackup}
          />
        )}

        {onAction && !inProgress && (updateAvailable || Boolean(skippedVersion)) && (
          <Row justify="end" gapPx={8} wrap>
            {skippedVersion && !updateAvailable && (
              <HausButton
                variant="secondary"
                size="sm"
                disabled={pending}
                label="Restore skipped update"
                onPress={() => onAction(buildAction(entity, 'update-clear-skipped'))}
              />
            )}
            {updateAvailable && (
              <>
                <HausButton
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  label="Skip version"
                  onPress={() => onAction(buildAction(entity, 'update-skip'))}
                />
                {canInstall && (
                  <HausButton
                    variant="primary"
                    size="sm"
                    disabled={pending}
                    label={latestVersion ? `Install ${latestVersion}` : 'Install update'}
                    onPress={() =>
                      onAction(
                        buildAction(
                          entity,
                          'update-install',
                          createBackup ? { backup: true } : undefined,
                        ),
                      )
                    }
                  />
                )}
              </>
            )}
          </Row>
        )}
      </Stack>
    </HausCard>
  );
}

export function DeviceFirmwareSection({
  accessory,
  pending = false,
  onAction,
}: {
  readonly accessory: HausAccessory;
  readonly pending?: boolean;
  readonly onAction?: (action: Action) => void;
}) {
  const updates = findDeviceUpdateEntities(accessory);
  if (updates.length === 0) return null;

  return (
    <Stack gapPx={10} style={{ layout: { width: pct(100) } }}>
      {updates.map((entity) => (
        <FirmwareUpdateCard
          key={entity.entity_id}
          entity={entity}
          deviceName={accessory.name}
          pending={pending}
          onAction={onAction}
        />
      ))}
    </Stack>
  );
}
