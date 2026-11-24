/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useCallback, useState } from 'react';
import { DeviceTile } from '@haus/ui/components';
import { HausButton, Stack, Text, VideoSurface } from '@haus/ui/primitives';
import { colorToken, pct, px, SolidMaterial, type UiStyleSpec } from '@haus/ui/ir';
import type { GpuiCameraStreams } from './stream.js';

const videoStyle: UiStyleSpec = {
  layout: { width: pct(100), height: px(320) },
  material: new SolidMaterial(colorToken('surface')),
};

function CameraFrame({
  hub,
  id,
  streams,
}: {
  hub: string;
  id: string;
  streams: GpuiCameraStreams;
}) {
  const [state, setState] = useState<'connecting' | 'playing' | 'reconnecting' | 'stopped'>(
    'connecting',
  );
  const [attempt, setAttempt] = useState(0);
  const frames = useCallback(
    (signal: AbortSignal) => streams.open(hub, id, signal, setState),
    [hub, id, streams],
  );
  return (
    <Stack gapPx={8}>
      <VideoSurface
        key={attempt}
        id={`stream-${id}`}
        frameSource={frames}
        style={videoStyle}
        onEnded={() => setState('stopped')}
        onError={() => setState('stopped')}
      />
      {state === 'connecting' && (
        <Text tone="secondary" role="status">
          Connecting to the camera…
        </Text>
      )}
      {state === 'reconnecting' && (
        <Text tone="secondary" role="status">
          Reconnecting to the camera…
        </Text>
      )}
      {state === 'stopped' && (
        <Stack gapPx={6}>
          <Text tone="critical" role="alert">
            Live playback stopped.
          </Text>
          <HausButton
            variant="secondary"
            onPress={() => {
              setState('connecting');
              setAttempt((value) => value + 1);
            }}
          >
            Retry
          </HausButton>
        </Stack>
      )}
    </Stack>
  );
}

export function CameraSection({
  hub,
  cameras,
  streams,
  initialCamera,
}: {
  hub: string;
  cameras: readonly { id: string; name: string; available: boolean }[];
  streams: GpuiCameraStreams;
  initialCamera?: string;
}) {
  const [selected, setSelected] = useState<string | null>(initialCamera ?? null);
  if (!cameras.length) return null;
  return (
    <Stack gapPx={4}>
      <Text tone="primary" size={16} weight={600}>
        Cameras
      </Text>
      {cameras.map(({ id, name, available }) => (
        <DeviceTile
          key={id}
          frame={{ id: `camera-${id}` }}
          compact
          iconName="eye"
          name={name}
          available={available}
          state="Live view"
          opened={available && selected === id}
          onOpen={
            available ? () => setSelected((current) => (current === id ? null : id)) : undefined
          }
          details={<CameraFrame key={hub} hub={hub} id={id} streams={streams} />}
        />
      ))}
    </Stack>
  );
}
