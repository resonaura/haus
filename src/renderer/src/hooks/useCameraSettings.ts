import { useEffect, useSyncExternalStore } from 'react';
import { cameraSettings } from '../ha/camera-settings';

export function useCameraSettings(id: string, enabled = true) {
  const camera = useSyncExternalStore(cameraSettings.subscribe, () =>
    enabled ? cameraSettings.get(id) : undefined,
  );
  useEffect(() => {
    if (!enabled) return;
    const refresh = () => {
      if (document.visibilityState === 'visible') void cameraSettings.refresh().catch(() => {});
    };
    refresh();
    const timer = setInterval(refresh, 10000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [id, enabled]);
  return camera;
}
