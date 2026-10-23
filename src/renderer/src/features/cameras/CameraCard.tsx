import { useCameraPreheat } from './useCameraPreheat';
import { useElementVisibility } from '../../hooks/useElementVisibility';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera as CameraIcon, ArrowRight, VideoOff } from 'lucide-react';
import type { HassEntity } from '../../model';
import { deviceDisplayName } from '../../model/device-name';
import { formatSnapshotAge, snapshotAgeSeconds } from '../../model/snapshot-age';
import { SmoothImage } from '../../components/ui/SmoothImage';
export function cameraImage(entity: HassEntity, index = 0): string {
  const scene = entity.attributes.demo_scene;
  return `/images/${scene === 'front-door' ? 'entryway' : scene === 'garden' ? 'garden' : scene === 'living-room' ? 'living-room' : ['entryway', 'garden', 'living-room'][index % 3]}.jpg`;
}
export function CameraPreview({
  entity,
  demo,
  index = 0,
  onSnapshotLoaded,
  onOfflineChange,
  onRecoveryChange,
  enabled = true,
}: {
  entity: HassEntity;
  demo: boolean;
  index?: number;
  onSnapshotLoaded?: (timestamp: number) => void;
  onOfflineChange?: (offline: boolean) => void;
  onRecoveryChange?: (recovering: boolean) => void;
  enabled?: boolean;
}) {
  const sourceAvailable = !['unavailable', 'unknown', 'off'].includes(entity.state);
  useCameraPreheat(entity.entity_id, enabled && !demo && sourceAvailable);
  const [frame, setFrame] = useState<{ image: string; receivedAt: number; fresh: boolean }>();
  const displayedImage = useRef('');
  const [cached, setCached] = useState(false);
  const fresh = useRef(false);
  const [offline, setOffline] = useState(false);
  const offlineRef = useRef(false);
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
    setFrame(undefined);
    displayedImage.current = '';
    fresh.current = false;
    setCached(false);
    offlineRef.current = false;
    setOffline(false);
    setRecovering(false);
    recoveryChanged.current?.(false);
    offlineChanged.current?.(false);
    if (recoveryTimer.current) clearTimeout(recoveryTimer.current);
  }, [entity.entity_id, demo]);
  useEffect(
    () => () => {
      if (offlineTimer.current) clearTimeout(offlineTimer.current);
      if (recoveryTimer.current) clearTimeout(recoveryTimer.current);
    },
    [],
  );
  useEffect(() => {
    if (demo || !enabled) return;
    let active = true;
    let refreshing = false;
    const observe = () => {
      if (offlineTimer.current) clearTimeout(offlineTimer.current);
      if (document.visibilityState === 'visible')
        offlineTimer.current = setTimeout(() => changeOffline(true), 30_000);
    };
    const refresh = async () => {
      if (!active || refreshing || document.visibilityState !== 'visible' || !window.hausNative)
        return;
      refreshing = true;
      try {
        const image = await window.hausNative.cameraSnapshot(entity.entity_id);
        if (!active || !image) return;
        const receivedAt = Date.now();
        observe();
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
        setFrame({ image, receivedAt, fresh: true });
      } catch {
        // Keep the last frame and its age when a refresh fails.
      } finally {
        refreshing = false;
      }
    };
    // Time spent offscreen or in history is not an observed camera outage.
    // Give the resumed request a complete grace window before declaring one.
    observe();
    void refresh();
    const interval = setInterval(() => void refresh(), 10000);
    const onVisible = () => {
      observe();
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      if (offlineTimer.current) clearTimeout(offlineTimer.current);
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [entity.entity_id, demo, enabled, changeOffline]);
  return (
    <>
      {demo || frame ? (
        <SmoothImage
          className={offline ? 'is-cached-preview' : cached ? 'is-loading-preview' : ''}
          thumbnail
          progressiveBlur={!cached && sourceAvailable}
          src={demo ? cameraImage(entity, index) : frame?.image}
          alt={`${String(entity.attributes.friendly_name ?? 'Camera')} ${demo ? 'demonstration' : 'snapshot'}`}
          onLoad={(source) => {
            if (!demo && frame && source === frame.image) {
              displayedImage.current = frame.image;
              setCached(!frame.fresh || !fresh.current);
              onLoadedRef.current?.(frame.receivedAt);
            }
          }}
        />
      ) : (
        <span className="camera-placeholder">
          {!offline && <CameraIcon size={27} strokeWidth={1.4} />}
        </span>
      )}
      {(offline || recovering) && <CameraOfflineIndicator exiting={recovering} />}
    </>
  );
}

export function CameraOfflineIndicator({ exiting = false }: { exiting?: boolean }) {
  return (
    <span
      className={`camera-offline-indicator ${exiting ? 'is-exiting' : ''}`}
      role="img"
      aria-label="Camera offline"
    >
      <VideoOff size={32} strokeWidth={1.35} aria-hidden="true" />
    </span>
  );
}

export function SnapshotAge({ updatedAt }: { updatedAt: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!updatedAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [updatedAt]);
  const seconds = snapshotAgeSeconds(updatedAt, Math.max(now, updatedAt));
  return seconds === undefined ? (
    '—'
  ) : (
    <time
      dateTime={new Date(updatedAt).toISOString()}
      title={`${seconds} seconds since the snapshot updated`}
    >
      {formatSnapshotAge(seconds)}
    </time>
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
  const [offline, setOffline] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const { ref, visible } = useElementVisibility<HTMLButtonElement>();
  return (
    <button
      ref={ref}
      className={`camera-card ${recovering ? 'is-recovering-preview' : ''}`}
      onClick={onOpen}
      aria-label={`Open ${String(entity.attributes.friendly_name ?? 'Camera')}`}
    >
      <CameraPreview
        entity={entity}
        demo={demo}
        index={index}
        onSnapshotLoaded={setUpdatedAt}
        onOfflineChange={setOffline}
        onRecoveryChange={setRecovering}
        enabled={visible && !paused}
      />
      <span className="camera-age-badge">
        {demo ? 'Preview' : <SnapshotAge updatedAt={updatedAt} />}
        {!demo && offline && <span>Offline</span>}
      </span>
      <div className="camera-shade" aria-hidden="true"></div>
      <span className="camera-label">
        {room && <small className="camera-room-label">{room}</small>}
        {deviceDisplayName(String(entity.attributes.friendly_name ?? 'Camera'), room, 'Camera')}
      </span>
      <span className="camera-expand">
        <ArrowRight size={17} />
      </span>
    </button>
  );
}
