/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useState, type ReactNode } from 'react';
import {
  computeStorageQuotaRangeGib,
  formatBytes,
  SERVER_GIB,
  type ServerSummaryRecord,
} from '@haus/core/transport';
import { colorToken, corners, insets, pct, px, transparentColor } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import {
  Box,
  Grid,
  HausButton,
  Heading,
  Pressable,
  RangeInput,
  Row,
  Stack,
  Text,
  TextInput,
} from '../../primitives/index.js';
import { GlassRim } from '../../primitives/glass-rim.js';
import { UiIcon } from '../icon.js';
import { HausStorageUsageCard } from './parts/haus-storage-card.js';
import { ServerGlassPanel } from './server-surfaces.js';

/** 100% Electron-matched NVR workspace: capabilities, storage budget slider/input, and Haus Storage breakdown. */
export function ServerNvrTab({
  server,
  canManage,
  busy = false,
  backupsSlot,
  onSaveStorageLimit,
}: {
  readonly server: ServerSummaryRecord;
  readonly canManage: boolean;
  readonly busy?: boolean;
  readonly backupsSlot?: ReactNode;
  readonly onSaveStorageLimit?: (limitBytes: number | null) => Promise<void>;
}) {
  const nvr = server.nvr;
  const live = server.online === true && server.enabled !== false;
  const savedLimit = nvr?.limitBytes ?? null;
  const [draft, setDraft] = useState<number | null | undefined>(undefined);
  const [savedFeedback, setSavedFeedback] = useState(false);

  if (!nvr) return null;

  const currentLimit = draft === undefined ? savedLimit : draft;
  const maxGib = computeStorageQuotaRangeGib(server);
  const changed = currentLimit !== savedLimit;
  const localCache = server.kind === 'home-assistant' && nvr.cachePolicy === 'verified-archive';
  const canEditBudget = canManage && Boolean(onSaveStorageLimit) && !busy && live;

  const updateDraft = (value: number | null) => {
    setDraft(value);
    setSavedFeedback(false);
  };

  const handleSave = () => {
    if (!onSaveStorageLimit || !changed) return;
    void onSaveStorageLimit(currentLimit)
      .then(() => {
        setDraft(undefined);
        setSavedFeedback(true);
      })
      .catch(() => undefined);
  };

  const sliderPct =
    currentLimit !== null
      ? Math.max(
          0,
          Math.min(100, ((currentLimit / SERVER_GIB - 1) / Math.max(1, maxGib - 1)) * 100),
        )
      : 0;

  return (
    <Stack gapPx={14} style={{ layout: { width: pct(100) } }}>
      <ServerGlassPanel padding={insets(24)} radius={24}>
        <Stack gapPx={16} style={{ layout: { width: pct(100) } }}>
          <Stack gapPx={4}>
            <Row align="center" gapPx={9}>
              <UiIcon name="video" size={18} />
              <Heading level={3} size={16} weight={600}>
                Haus NVR
              </Heading>
            </Row>
            <Text size={12} tone="muted">
              Camera recording, streaming and recovery copies are separate from this server’s system
              information.
            </Text>
          </Stack>

          <Grid columns={2} minColumnWidthPx={220} gapPx={12}>
            <Box
              style={{
                layout: { padding: insets(14, 16) },
                material: new SolidMaterial(colorToken('soft')),
                border: { width: 1, color: colorToken('border') },
                corners: corners(16),
              }}
            >
              <Stack gapPx={4}>
                <Row align="center" justify="between">
                  <Text size={13} weight={600}>
                    Recording storage
                  </Text>
                  <Text size={11.5} tone={nvr.storageAssigned ? 'primary' : 'muted'} weight={500}>
                    {nvr.storageAssigned ? 'Assigned' : 'Not assigned'}
                  </Text>
                </Row>
                <Text size={11.5} tone="muted" style={{ typography: { lineHeight: 1.45 } }}>
                  Store camera recordings and encrypted recovery copies for this home.
                </Text>
              </Stack>
            </Box>

            <Box
              style={{
                layout: { padding: insets(14, 16) },
                material: new SolidMaterial(colorToken('soft')),
                border: { width: 1, color: colorToken('border') },
                corners: corners(16),
              }}
            >
              <Stack gapPx={4}>
                <Row align="center" justify="between">
                  <Text size={13} weight={600}>
                    Video streaming
                  </Text>
                  <Text size={11.5} tone={nvr.streamingAssigned ? 'primary' : 'muted'} weight={500}>
                    {nvr.streamingAssigned ? 'Assigned' : 'Not assigned'}
                  </Text>
                </Row>
                <Text size={11.5} tone="muted" style={{ typography: { lineHeight: 1.45 } }}>
                  Relay camera video and help prepare recordings for playback.
                </Text>
              </Stack>
            </Box>
          </Grid>

          <Row gapPx={22} wrap ariaLabel="NVR work on this server">
            {nvr.activeStreams && nvr.streamingAssigned && (
              <Stack gapPx={2}>
                <Text size={16} weight={600} style={{ typography: { tabularNums: true } }}>
                  {live ? nvr.activeStreams : '—'}
                </Text>
                <Text size={11} tone="muted">
                  Active streams
                </Text>
              </Stack>
            )}
            {nvr.playbackPrep && nvr.streamingAssigned && (
              <Stack gapPx={2}>
                <Text size={16} weight={600} style={{ typography: { tabularNums: true } }}>
                  {live ? nvr.playbackPrep : '—'}
                </Text>
                <Text size={11} tone="muted">
                  Playback preparation
                </Text>
              </Stack>
            )}
            {nvr.activityAssist && nvr.streamingAssigned && (
              <Stack gapPx={2}>
                <Text size={16} weight={600} style={{ typography: { tabularNums: true } }}>
                  {live ? nvr.activityAssist : '—'}
                </Text>
                <Text size={11} tone="muted">
                  Activity assist
                </Text>
              </Stack>
            )}
            {nvr.backupCopies !== undefined && (
              <Stack gapPx={2}>
                <Text size={16} weight={600} style={{ typography: { tabularNums: true } }}>
                  {String(nvr.backupCopies)}
                </Text>
                <Text size={11} tone="muted">
                  Recovery copies on this server
                </Text>
              </Stack>
            )}
          </Row>

          <Text size={11.5} tone="muted">
            NVR roles are chosen when this server is paired. Activity assist uses compatible
            streaming servers when enabled for a camera.
          </Text>
        </Stack>
      </ServerGlassPanel>

      {(nvr.hasSettings || nvr.limitBytes !== undefined || onSaveStorageLimit) && (
        <ServerGlassPanel padding={insets(24)} radius={24}>
          <Stack gapPx={16} style={{ layout: { width: pct(100) } }}>
            <Row align="start" justify="between" gapPx={16} style={{ layout: { width: pct(100) } }}>
              <Stack gapPx={4} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
                <Heading level={3} size={15} weight={600}>
                  {localCache ? 'Recent video on this Hub' : 'NVR storage budget'}
                </Heading>
                <Text size={12} tone="muted">
                  {localCache
                    ? 'Keep recent recordings here; older footage stays on your NVR servers.'
                    : server.kind === 'home-assistant' || server.kind === 'hub'
                      ? 'Set a budget for original camera recordings.'
                      : 'Set a budget for NVR media and encrypted recovery copies. Other services and files are not limited.'}
                </Text>
              </Stack>
              <Text size={14} weight={600} style={{ typography: { tabularNums: true } }}>
                {currentLimit === null ? 'Unlimited' : formatBytes(currentLimit)}
              </Text>
            </Row>

            <Row
              gapPx={4}
              ariaLabel="NVR storage limit"
              style={{
                layout: { padding: insets(4), alignSelf: 'start' },
                material: new SolidMaterial(colorToken('soft')),
                border: { width: 1, color: colorToken('border') },
                corners: corners(16),
              }}
            >
              <Pressable
                ariaPressed={currentLimit === null}
                disabled={!canEditBudget}
                onActivate={() => updateDraft(null)}
                style={{
                  layout: {
                    display: 'flex',
                    direction: 'row',
                    alignItems: 'center',
                    gap: px(7),
                    padding: insets(8, 14),
                    position: 'relative',
                    overflow: 'hidden',
                  },
                  material: new SolidMaterial(
                    currentLimit === null ? colorToken('card') : transparentColor,
                  ),
                  border: { width: 0, style: 'none', color: transparentColor },
                  corners: corners(12),
                }}
              >
                <UiIcon name="infinity" size={16} />
                <Text size={12} weight={currentLimit === null ? 600 : 500}>
                  Unlimited
                </Text>
                {currentLimit === null && (
                  <GlassRim preset="control" radiusPx={11} opacity={0.62} />
                )}
              </Pressable>

              <Pressable
                ariaPressed={currentLimit !== null}
                disabled={!canEditBudget}
                onActivate={() => {
                  if (currentLimit === null) {
                    updateDraft(Math.min(maxGib, Math.max(1, Math.round(maxGib / 2))) * SERVER_GIB);
                  }
                }}
                style={{
                  layout: {
                    display: 'flex',
                    direction: 'row',
                    alignItems: 'center',
                    gap: px(7),
                    padding: insets(8, 14),
                    position: 'relative',
                    overflow: 'hidden',
                  },
                  material: new SolidMaterial(
                    currentLimit !== null ? colorToken('card') : transparentColor,
                  ),
                  border: { width: 0, style: 'none', color: transparentColor },
                  corners: corners(12),
                }}
              >
                <UiIcon name="hard-drive" size={15} />
                <Text size={12} weight={currentLimit !== null ? 600 : 500}>
                  Set a limit
                </Text>
                {currentLimit !== null && (
                  <GlassRim preset="control" radiusPx={11} opacity={0.62} />
                )}
              </Pressable>
            </Row>

            {(nvr.usedBytes != null ||
              nvr.freeBytes != null ||
              nvr.availableBytes !== undefined) && (
              <Row align="center" justify="between" wrap gapPx={8}>
                <Text size={12} tone="muted" style={{ typography: { tabularNums: true } }}>
                  {`${formatBytes(nvr.usedBytes)} ${localCache ? 'on this Hub' : 'saved'}`}
                </Text>
                <Text size={12} tone="muted" style={{ typography: { tabularNums: true } }}>
                  {nvr.availableBytes !== undefined
                    ? nvr.availableBytes === null
                      ? 'Available space is not reported'
                      : `${formatBytes(nvr.availableBytes)} available for Haus`
                    : `${formatBytes(nvr.freeBytes)} free on disk`}
                </Text>
              </Row>
            )}

            {localCache && nvr.archivedBytes !== undefined && (
              <Text size={11.5} tone="muted">
                {`${formatBytes(nvr.archivedBytes)} archived on NVR · 10 GB local cache by default`}
              </Text>
            )}

            {currentLimit !== null && (
              <Row align="center" gapPx={14} style={{ layout: { width: pct(100) } }}>
                <Stack gapPx={6} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
                  <Row align="center" justify="between">
                    <Text size={11.5} weight={500}>
                      Storage budget
                    </Text>
                    <Text size={11.5} tone="muted" style={{ typography: { tabularNums: true } }}>
                      {formatBytes(currentLimit)}
                    </Text>
                  </Row>
                  <Box
                    style={{
                      layout: {
                        width: pct(100),
                        height: px(24),
                        position: 'relative',
                        display: 'flex',
                        alignItems: 'center',
                      },
                    }}
                  >
                    <Box
                      style={{
                        layout: { width: pct(100), height: px(6), overflow: 'hidden' },
                        material: new SolidMaterial(colorToken('soft')),
                        corners: corners(999, 'round'),
                      }}
                    >
                      <Box
                        style={{
                          layout: { width: pct(sliderPct), height: pct(100) },
                          material: new SolidMaterial(colorToken('textPrimary')),
                          corners: corners(999, 'round'),
                        }}
                      />
                    </Box>
                    <RangeInput
                      ariaLabel="Storage budget in gigabytes"
                      min={1}
                      max={maxGib}
                      step={1}
                      value={Math.round(currentLimit / SERVER_GIB)}
                      disabled={!canEditBudget}
                      onChange={(gb) => updateDraft(Math.min(maxGib, Math.max(1, gb)) * SERVER_GIB)}
                    />
                  </Box>
                </Stack>

                <Row align="center" gapPx={6} style={{ layout: { flexShrink: 0 } }}>
                  <TextInput
                    ariaLabel="Exact storage budget in gigabytes"
                    inputType="number"
                    min={1}
                    max={maxGib}
                    step={1}
                    value={String(Math.max(1, Math.round(currentLimit / SERVER_GIB)))}
                    disabled={!canEditBudget}
                    style={{ layout: { width: px(84) } }}
                    onChange={(raw) => {
                      const val = Number(raw);
                      if (Number.isFinite(val) && val >= 1) {
                        updateDraft(Math.min(maxGib, Math.round(val)) * SERVER_GIB);
                      }
                    }}
                  />
                  <Text size={12} tone="muted" weight={500}>
                    GB
                  </Text>
                </Row>
              </Row>
            )}

            <Row
              align="center"
              justify="between"
              gapPx={14}
              wrap
              style={{ layout: { width: pct(100) } }}
            >
              <Text size={11.5} tone="muted" style={{ layout: { flexGrow: 1, minWidth: px(220) } }}>
                {currentLimit === null
                  ? 'No fixed cap. Haus keeps a reserve of free disk space. Recording retention still applies.'
                  : localCache
                    ? 'Older local files are released after their NVR archive is verified. Your timeline stays available.'
                    : 'Existing files stay. New recordings or copies pause safely at this limit.'}
              </Text>
              {canManage && onSaveStorageLimit && (
                <HausButton
                  id="server-save-storage-limit"
                  variant={changed ? 'primary' : 'ghost'}
                  size="sm"
                  disabled={busy || !changed || !live}
                  onPress={handleSave}
                >
                  {savedFeedback && !changed ? (
                    <Row align="center" gapPx={5}>
                      <UiIcon name="check" size={14} />
                      <Text size={12}>Saved</Text>
                    </Row>
                  ) : (
                    <Text size={12}>Save limit</Text>
                  )}
                </HausButton>
              )}
            </Row>
          </Stack>
        </ServerGlassPanel>
      )}

      <HausStorageUsageCard usage={nvr.usage} online={live} />
      {backupsSlot}
    </Stack>
  );
}
