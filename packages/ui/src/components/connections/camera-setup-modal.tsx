/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useState } from 'react';
import { colorToken, corners, insets, pct, px, rgba } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import {
  Box,
  HausButton,
  HausDialog,
  HausSelect,
  Row,
  Stack,
  Text,
  TextInput,
  useHausUi,
} from '../../primitives/index.js';
import { ManagementGlassCard } from '../brand/index.js';
import { UiIcon } from '../icon.js';
import type { UiIconName } from '../icons.js';

export interface CameraExistingOption {
  readonly entityId: string;
  readonly name: string;
  readonly areaId?: string;
}

export interface CameraRoomOption {
  readonly id: string;
  readonly name: string;
}

function CameraPathCard({
  id,
  icon,
  title,
  subtitle,
  onPress,
}: {
  readonly id: string;
  readonly icon: UiIconName;
  readonly title: string;
  readonly subtitle: string;
  readonly onPress: () => void;
}) {
  return (
    <ManagementGlassCard
      id={id}
      radius={18}
      padding={insets(13, 15)}
      interactive
      onPress={onPress}
      style={{ layout: { width: pct(100) } }}
    >
      <Row align="center" justify="between" gapPx={12} style={{ layout: { width: pct(100) } }}>
        <Row align="center" gapPx={12} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
          <Box
            style={{
              layout: {
                width: px(36),
                height: px(36),
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              },
              material: new SolidMaterial(colorToken('surface')),
              border: { width: 1, color: colorToken('border') },
              corners: corners(11),
            }}
          >
            <UiIcon name={icon} size={17} />
          </Box>
          <Stack gapPx={2} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
            <Text size={13.5} weight={600}>
              {title}
            </Text>
            <Text size={11.5} tone="muted" style={{ typography: { size: 11.5, lineHeight: 1.35 } }}>
              {subtitle}
            </Text>
          </Stack>
        </Row>
        <UiIcon name="chevron-right" size={15} />
      </Row>
    </ManagementGlassCard>
  );
}

/**
 * Shared Electron-matched Camera Setup launcher modal using refined glass cards.
 */
export function CameraSetupModal({
  existingCameraCount = 0,
  onChooseApps,
  onChooseFindBrand,
  onChooseExisting,
  onChooseManual,
  onBack,
  onClose,
}: {
  readonly existingCameraCount?: number;
  readonly onChooseApps: () => void;
  readonly onChooseFindBrand: () => void;
  readonly onChooseExisting?: () => void;
  readonly onChooseManual: () => void;
  readonly onBack?: () => void;
  readonly onClose: () => void;
}) {
  return (
    <HausDialog
      size="md"
      eyebrow="ADD CAMERA"
      title="A little peace of mind."
      subtitle="Start with your camera’s brand, an installed NVR App, or connect directly with an RTSP address."
      scrollable
      onClose={onClose}
      footer={
        <Row justify="between" align="center" style={{ layout: { width: pct(100) } }}>
          {onBack ? (
            <HausButton variant="ghost" size="sm" onPress={onBack}>
              <UiIcon name="arrow-left" size={14} />
              <Text size={12.5}>Back</Text>
            </HausButton>
          ) : (
            <Box />
          )}
          <HausButton variant="ghost" onPress={onClose}>
            <Text size={12.5}>Cancel</Text>
          </HausButton>
        </Row>
      }
    >
      <Stack gapPx={12} style={{ layout: { width: pct(100) } }}>
        <CameraPathCard
          id="camera-path-apps"
          icon="box"
          title="Manage camera Apps"
          subtitle="Connect cameras from Scrypted, Frigate, go2rtc, or an installed NVR"
          onPress={onChooseApps}
        />
        <CameraPathCard
          id="camera-path-brand"
          icon="radar"
          title="Find a camera"
          subtitle="Discovered cameras and supported brands (Reolink, UniFi, ONVIF, Tuya, Aqara…)"
          onPress={onChooseFindBrand}
        />
        {existingCameraCount > 0 && onChooseExisting && (
          <CameraPathCard
            id="camera-path-existing"
            icon="camera"
            title="Use an existing camera"
            subtitle={`Assign name and room for ${existingCameraCount} ${existingCameraCount === 1 ? 'camera' : 'cameras'} already in your home`}
            onPress={onChooseExisting}
          />
        )}
        <CameraPathCard
          id="camera-path-manual"
          icon="globe"
          title="Connect with an address"
          subtitle="RTSP live stream URL or still snapshot URL"
          onPress={onChooseManual}
        />
        <Text size={11.5} tone="muted" style={{ typography: { size: 11.5, lineHeight: 1.45 } }}>
          New cameras start in Stream only. You can enable local event recording in camera settings.
        </Text>
      </Stack>
    </HausDialog>
  );
}

const CAMERA_INPUT_STYLE = {
  layout: { width: pct(100), minHeight: px(38), padding: insets(8, 12) },
  material: new SolidMaterial(colorToken('surface')),
  border: { width: 1, color: colorToken('border') },
  corners: corners(11),
  typography: { size: 13, color: colorToken('textPrimary') },
} as const;

/**
 * Shared manual RTSP/Snapshot or existing camera configuration modal.
 */
export function ManualCameraSetupModal({
  mode,
  existingCameras = [],
  rooms = [],
  busy = false,
  error,
  onBack,
  onSubmitManual,
  onSubmitExisting,
  onClose,
}: {
  readonly mode: 'manual' | 'existing';
  readonly existingCameras?: readonly CameraExistingOption[];
  readonly rooms?: readonly CameraRoomOption[];
  readonly busy?: boolean;
  readonly error?: string;
  readonly onBack: () => void;
  readonly onSubmitManual: (input: {
    readonly streamUrl: string;
    readonly snapshotUrl: string;
    readonly name: string;
    readonly roomId: string;
  }) => void;
  readonly onSubmitExisting: (input: {
    readonly entityId: string;
    readonly name: string;
    readonly roomId: string;
  }) => void;
  readonly onClose: () => void;
}) {
  const { theme } = useHausUi();
  const dark = theme.mode === 'dark';
  const [selectedEntityId, setSelectedEntityId] = useState(existingCameras[0]?.entityId ?? '');
  const [name, setName] = useState(
    mode === 'existing' ? (existingCameras[0]?.name ?? 'Camera') : 'Camera',
  );
  const [roomId, setRoomId] = useState(
    mode === 'existing' ? (existingCameras[0]?.areaId ?? '') : '',
  );
  const [streamUrl, setStreamUrl] = useState('');
  const [snapshotUrl, setSnapshotUrl] = useState('');

  const canSubmit =
    mode === 'existing'
      ? Boolean(selectedEntityId)
      : Boolean(streamUrl.trim() || snapshotUrl.trim());

  return (
    <HausDialog
      size="md"
      eyebrow={mode === 'existing' ? 'YOUR CAMERAS' : 'CUSTOM CAMERA'}
      title={mode === 'existing' ? 'Choose your camera' : 'Make the connection.'}
      subtitle={
        mode === 'existing'
          ? 'Rename an existing camera and assign it to a room.'
          : 'Enter an RTSP stream address or snapshot URL to add a generic camera.'
      }
      scrollable
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <Row justify="between" align="center" style={{ layout: { width: pct(100) } }}>
          <HausButton variant="ghost" size="sm" disabled={busy} onPress={onBack}>
            <UiIcon name="arrow-left" size={14} />
            <Text size={12.5}>Back</Text>
          </HausButton>
          <Row align="center" gapPx={8}>
            <HausButton variant="ghost" disabled={busy} onPress={onClose}>
              <Text size={12.5}>Cancel</Text>
            </HausButton>
            <HausButton
              id="manual-camera-submit"
              variant="primary"
              disabled={busy || !canSubmit}
              onPress={() => {
                if (mode === 'existing') {
                  onSubmitExisting({
                    entityId: selectedEntityId,
                    name: name.trim() || 'Camera',
                    roomId,
                  });
                } else {
                  onSubmitManual({
                    streamUrl: streamUrl.trim(),
                    snapshotUrl: snapshotUrl.trim(),
                    name: name.trim() || 'Camera',
                    roomId,
                  });
                }
              }}
            >
              <Text
                size={12.5}
                style={{ typography: { color: colorToken('accentForeground'), weight: 600 } }}
              >
                {busy ? 'Saving…' : mode === 'existing' ? 'Save camera' : 'Continue'}
              </Text>
            </HausButton>
          </Row>
        </Row>
      }
    >
      <Stack gapPx={12} style={{ layout: { width: pct(100) } }}>
        {error && (
          <Row
            align="center"
            gapPx={8}
            style={{
              layout: { width: pct(100), padding: insets(10, 12) },
              material: new SolidMaterial(rgba(239, 68, 68, dark ? 0.14 : 0.1)),
              border: { width: 1, color: rgba(239, 68, 68, 0.34) },
              corners: corners(12),
            }}
          >
            <UiIcon name="alert-circle" size={15} color={dark ? '#fca5a5' : '#b91c1c'} />
            <Text size={12} tone="critical">
              {error}
            </Text>
          </Row>
        )}

        {mode === 'existing' ? (
          <Stack gapPx={6}>
            <Text size={12} weight={600}>
              Camera
            </Text>
            <HausSelect
              id="manual-camera-existing-select"
              aria-label="Camera"
              value={selectedEntityId}
              disabled={busy}
              options={[
                { value: '', label: 'Choose camera…' },
                ...existingCameras.map((cam) => ({ value: cam.entityId, label: cam.name })),
              ]}
              onChange={(nextId) => {
                setSelectedEntityId(nextId);
                const found = existingCameras.find((cam) => cam.entityId === nextId);
                if (found) {
                  setName(found.name);
                  setRoomId(found.areaId ?? '');
                }
              }}
              style={{ layout: { width: pct(100) } }}
            />
          </Stack>
        ) : (
          <>
            <Stack gapPx={5}>
              <Text size={12} weight={600}>
                Live stream URL (RTSP / HLS)
              </Text>
              <TextInput
                id="manual-camera-stream-url"
                ariaLabel="Live stream URL"
                placeholder="rtsp://user:pass@192.168.1.80:554/stream1"
                value={streamUrl}
                disabled={busy}
                onChange={setStreamUrl}
                style={CAMERA_INPUT_STYLE}
              />
            </Stack>
            <Stack gapPx={5}>
              <Text size={12} weight={600}>
                Snapshot image URL (optional)
              </Text>
              <TextInput
                id="manual-camera-snapshot-url"
                ariaLabel="Snapshot image URL"
                placeholder="http://192.168.1.80/snapshot.jpg"
                value={snapshotUrl}
                disabled={busy}
                onChange={setSnapshotUrl}
                style={CAMERA_INPUT_STYLE}
              />
            </Stack>
          </>
        )}

        <Stack gapPx={5}>
          <Text size={12} weight={600}>
            Display name
          </Text>
          <TextInput
            id="manual-camera-name"
            ariaLabel="Camera name"
            placeholder="Front Door"
            value={name}
            disabled={busy}
            onChange={setName}
            style={CAMERA_INPUT_STYLE}
          />
        </Stack>

        {rooms.length > 0 && (
          <Stack gapPx={5}>
            <Text size={12} weight={600}>
              Room
            </Text>
            <HausSelect
              id="manual-camera-room"
              aria-label="Room"
              value={roomId}
              disabled={busy}
              options={[
                { value: '', label: 'Unassigned' },
                ...rooms.map((r) => ({ value: r.id, label: r.name })),
              ]}
              onChange={setRoomId}
              style={{ layout: { width: pct(100) } }}
            />
          </Stack>
        )}
      </Stack>
    </HausDialog>
  );
}
