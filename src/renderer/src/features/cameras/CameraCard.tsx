import { useCameraPreheat } from './useCameraPreheat';
import { useElementVisibility } from '../../hooks/useElementVisibility';
import { useEffect, useRef, useState } from 'react';
import { Camera as CameraIcon, ArrowRight } from 'lucide-react';
import type { HassEntity } from '../../model';
import { deviceDisplayName } from '../../model/device-name';
import { snapshotAgeSeconds } from '../../model/snapshot-age';
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
  enabled = true,
}: {
  entity: HassEntity;
  demo: boolean;
  index?: number;
  onSnapshotLoaded?: (timestamp: number) => void;
  enabled?: boolean;
}) {
  useCameraPreheat(
    entity.entity_id,
    enabled && !demo && !['unavailable', 'unknown'].includes(entity.state),
  );
  const [frame, setFrame] = useState<{ image: string; receivedAt: number }>();
  const displayedImage = useRef('');
  const [cached, setCached] = useState(false);
  const fresh = useRef(false);
  useEffect(
    () =>
      window.hausNative?.onEvent((event) => {
        if (event.type === 'connection' && ['connecting', 'disconnected'].includes(event.status)) {
          fresh.current = false;
          setFrame(undefined);
          setCached(false);
          displayedImage.current = '';
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
          setFrame((old) => old ?? value);
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
  }, [entity.entity_id, demo]);
  useEffect(() => {
    if (demo || !enabled) return;
    let active = true;
    let refreshing = false;
    const refresh = async () => {
      if (!active || refreshing || document.visibilityState !== 'visible' || !window.hausNative)
        return;
      refreshing = true;
      try {
        const image = await window.hausNative.cameraSnapshot(entity.entity_id);
        if (!active) return;
        const receivedAt = Date.now();
        // Identical bytes are already decoded; a successful refresh still renews the age.
        if (displayedImage.current === image) onLoadedRef.current?.(receivedAt);
        fresh.current = true;
        setFrame({ image, receivedAt });
      } catch {
        // Keep the last frame and its age when a refresh fails.
      } finally {
        refreshing = false;
      }
    };
    void refresh();
    const interval = setInterval(() => void refresh(), 10000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [entity.entity_id, demo, enabled]);
  return demo || frame ? (
    <SmoothImage
      className={cached ? 'is-cached-preview' : ''}
      thumbnail
      progressiveBlur
      src={demo ? cameraImage(entity, index) : frame?.image}
      alt={`${String(entity.attributes.friendly_name ?? 'Camera')} ${demo ? 'demonstration' : 'snapshot'}`}
      onLoad={() => {
        if (!demo && frame && displayedImage.current !== frame.image) {
          displayedImage.current = frame.image;
          setCached(!fresh.current);
          onLoadedRef.current?.(frame.receivedAt);
        }
      }}
    />
  ) : (
    <span className="camera-placeholder">
      <CameraIcon size={27} strokeWidth={1.4} />
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
      {seconds}s
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
  const { ref, visible } = useElementVisibility<HTMLButtonElement>();
  return (
    <button
      ref={ref}
      className="camera-card"
      onClick={onOpen}
      aria-label={`Open ${String(entity.attributes.friendly_name ?? 'Camera')}`}
    >
      <CameraPreview
        entity={entity}
        demo={demo}
        index={index}
        onSnapshotLoaded={setUpdatedAt}
        enabled={visible && !paused}
      />
      <span className="camera-age-badge">
        {demo ? 'Preview' : <SnapshotAge updatedAt={updatedAt} />}
        {!demo && entity.state === 'unavailable' && <span>Offline</span>}
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
