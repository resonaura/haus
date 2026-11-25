/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useCameraPreheat } from './useCameraPreheat';
import { useElementVisibility } from '../../hooks/useElementVisibility';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CameraPreviewTile, SnapshotAge, Text } from '@haus/ui';
import { Camera as CameraIcon, VideoOff } from 'lucide-react';
import type { HassEntity } from '../../model';
import { deviceDisplayName } from '../../model/device-name';
import { SmoothImage } from '@haus/ui/web';
import { resolveDemoSceneKey } from '../../../../shared/camera-preview';
import { sharedCameraSnapshotSync } from './snapshots/sync';

export { SnapshotAge };

export function cameraImage(entity: HassEntity, index = 0): string {
  return `${import.meta.env.BASE_URL}images/${resolveDemoSceneKey(entity.attributes.demo_scene, index)}.jpg`;
}
export function CameraPreview({
  entity,
  demo,
  index = 0,
  onSnapshotLoaded,
  onOfflineChange,
  onRecoveryChange,
  enabled = true,
  suppressOverlay = false,
}: {
  entity: HassEntity;
  demo: boolean;
  index?: number;
  onSnapshotLoaded?: (timestamp: number) => void;
  onOfflineChange?: (offline: boolean) => void;
  onRecoveryChange?: (recovering: boolean) => void;
  enabled?: boolean;
  suppressOverlay?: boolean;
}) {
  const sourceAvailable = !['unavailable', 'unknown', 'off'].includes(entity.state);
  const sourceOffline = entity.state === 'unavailable' || entity.state === 'off';
  useCameraPreheat(entity.entity_id, enabled && !demo && sourceAvailable);
  const [frame, setFrame] = useState<{
    image: string;
    receivedAt: number;
    capturedAt?: number;
    fresh: boolean;
  }>();
  const displayedImage = useRef('');
  const [cached, setCached] = useState(() => !demo && sourceOffline);
  const fresh = useRef(false);
  const [offline, setOffline] = useState(() => !demo && sourceOffline);
  const offlineRef = useRef(!demo && sourceOffline);
  const offlineTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [recovering, setRecovering] = useState(false);
  const recoveryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const offlineChanged = useRef(onOfflineChange);
  offlineChanged.current = onOfflineChange;
  const recoveryChanged = useRef(onRecoveryChange);
  recoveryChanged.current = onRecoveryChange;
  const changeOffline = useCallback((next: boolean) => {
    if (offlineRef.current === next) return;
    offlineRef.current = next;
    setOffline(next);
    offlineChanged.current?.(next);
  }, []);
  useEffect(
    () =>
      window.hausNative?.onEvent((event) => {
        if (event.type === 'connection' && ['connecting', 'disconnected'].includes(event.status)) {
          fresh.current = false;
          setCached(true);
        }
      }),
    [],
  );
  useEffect(() => {
    if (demo) return;
    let active = true;
    void window.hausNative
      ?.cameraLastSnapshot?.(entity.entity_id)
      .then((value) => {
        if (active && value && !fresh.current) {
          setFrame((old) => old ?? { ...value, fresh: false });
          setCached(true);
          onLoadedRef.current?.(value.receivedAt);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [entity.entity_id, demo]);
  const onLoadedRef = useRef(onSnapshotLoaded);
  onLoadedRef.current = onSnapshotLoaded;
  useEffect(() => {
    const initialOffline = !demo && sourceOffline;
    setFrame(undefined);
    displayedImage.current = '';
    fresh.current = false;
    setCached(initialOffline);
    offlineRef.current = initialOffline;
    setOffline(initialOffline);
    setRecovering(false);
    recoveryChanged.current?.(false);
    offlineChanged.current?.(initialOffline);
    if (recoveryTimer.current) clearTimeout(recoveryTimer.current);
  }, [entity.entity_id, demo]);
  useEffect(() => {
    if (demo || !sourceOffline) return;
    // Authoritative offline/unavailable/off state: keep the last cached frame,
    // blur immediately, show the offline indicator, and never wake an offline source.
    if (offlineTimer.current) clearTimeout(offlineTimer.current);
    fresh.current = false;
    setCached(true);
    changeOffline(true);
  }, [entity.entity_id, demo, sourceOffline, changeOffline]);
  useEffect(
    () => () => {
      if (offlineTimer.current) clearTimeout(offlineTimer.current);
      if (recoveryTimer.current) clearTimeout(recoveryTimer.current);
    },
    [],
  );
  useEffect(() => {
    if (demo || !enabled || sourceOffline) return;
    let active = true;
    const observe = (capturedAt = Date.now()) => {
      if (offlineTimer.current) clearTimeout(offlineTimer.current);
      if (document.visibilityState === 'visible')
        offlineTimer.current = setTimeout(
          () => changeOffline(true),
          Math.max(0, 30_000 - Math.max(0, Date.now() - capturedAt)),
        );
    };
    // Time spent offscreen or in history is not an observed camera outage.
    // Give the resumed request a complete grace window before declaring one.
    observe();
    const unsubscribe = sharedCameraSnapshotSync.subscribe({
      entityId: entity.entity_id,
      canFetch: () => active && sourceAvailable && Boolean(window.hausNative),
      fetchSnapshot: () => {
        const api = window.hausNative;
        if (!api) return Promise.reject(new Error('haus_native_unavailable'));
        return api.cameraSnapshot(entity.entity_id);
      },
      onVisibilityChange: () => {
        if (active) observe();
      },
      onFrame: ({ image, receivedAt, capturedAt, fresh: current }) => {
        if (!active || !image) return;
        if (!current) {
          if (!fresh.current) {
            setFrame({ image, receivedAt, capturedAt, fresh: false });
            setCached(true);
            onLoadedRef.current?.(receivedAt);
          }
          return;
        }
        observe(capturedAt ?? receivedAt);
        if (offlineRef.current) {
          changeOffline(false);
          setRecovering(true);
          recoveryChanged.current?.(true);
          if (recoveryTimer.current) clearTimeout(recoveryTimer.current);
          recoveryTimer.current = setTimeout(() => {
            setRecovering(false);
            recoveryChanged.current?.(false);
          }, 1200);
        }
        // Identical bytes are already decoded; a successful refresh still renews the age.
        if (displayedImage.current === image) {
          setCached(false);
          onLoadedRef.current?.(receivedAt);
        }
        fresh.current = true;
        setFrame({ image, receivedAt, capturedAt, fresh: true });
      },
    });
    return () => {
      active = false;
      if (offlineTimer.current) clearTimeout(offlineTimer.current);
      unsubscribe();
    };
  }, [entity.entity_id, demo, enabled, sourceAvailable, sourceOffline, changeOffline]);
  const isOffline = !demo && (offline || sourceOffline);
  return (
    <>
      {demo || frame ? (
        <SmoothImage
          className={
            suppressOverlay
              ? ''
              : isOffline
                ? 'is-cached-preview'
                : cached
                  ? 'is-loading-preview'
                  : ''
          }
          thumbnail
          src={demo ? cameraImage(entity, index) : frame?.image}
          alt={`${String(entity.attributes.friendly_name ?? 'Camera')} ${demo ? 'demonstration' : 'snapshot'}`}
          onLoad={(source) => {
            if (!demo && frame && source === frame.image) {
              displayedImage.current = frame.image;
              setCached(!frame.fresh || !fresh.current || sourceOffline);
              onLoadedRef.current?.(frame.receivedAt);
            }
          }}
        />
      ) : (
        <Text className="camera-placeholder">
          {!isOffline && <CameraIcon size={27} strokeWidth={1.4} />}
        </Text>
      )}
      {!suppressOverlay && (isOffline || recovering) && (
        <CameraOfflineIndicator exiting={recovering && !isOffline} />
      )}
    </>
  );
}

export function CameraOfflineIndicator({ exiting = false }: { exiting?: boolean }) {
  return (
    <Text
      className={`camera-offline-indicator ${exiting ? 'is-exiting' : ''}`}
      role="img"
      ariaLabel="Camera offline"
    >
      <VideoOff size={32} strokeWidth={1.35} aria-hidden="true" />
    </Text>
  );
}

export function CameraCard({
  entity,
  demo,
  index,
  room,
  onOpen,
  paused = false,
}: {
  entity: HassEntity;
  demo: boolean;
  index: number;
  room?: string;
  onOpen: () => void;
  paused?: boolean;
}) {
  const [updatedAt, setUpdatedAt] = useState(0);
  const sourceOffline = !demo && (entity.state === 'unavailable' || entity.state === 'off');
  const [offline, setOffline] = useState(sourceOffline);
  const [recovering, setRecovering] = useState(false);
  const { ref, visible } = useElementVisibility<HTMLButtonElement>();
  const isOffline = !demo && (offline || sourceOffline);
  const name = String(entity.attributes.friendly_name ?? 'Camera');
  return (
    <CameraPreviewTile
      pressableRef={ref}
      name={name}
      label={deviceDisplayName(name, room, 'Camera')}
      room={room}
      demo={demo}
      updatedAt={updatedAt}
      offline={isOffline}
      recovering={recovering}
      onOpen={onOpen}
      preview={
        <CameraPreview
          entity={entity}
          demo={demo}
          index={index}
          onSnapshotLoaded={setUpdatedAt}
          onOfflineChange={setOffline}
          onRecoveryChange={setRecovering}
          enabled={visible && !paused}
          suppressOverlay
        />
      }
    />
  );
}
