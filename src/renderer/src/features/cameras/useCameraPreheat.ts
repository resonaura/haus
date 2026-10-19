import { useEffect } from 'react';
/** Only visible previews request a bounded, muted server lease. Battery cameras are rejected by the helper. */
export function useCameraPreheat(id: string, enabled: boolean) {
  useEffect(() => {
    if (!enabled || !window.hausNative) return;
    const api = window.hausNative;
    const touch = (active: boolean) =>
      void api
        .helper({
          method: 'POST',
          path: `/api/cameras/${id}/warm`,
          data: { active, preview: true },
        })
        .catch(() => {});
    const update = () => touch(document.visibilityState === 'visible');
    update();
    const timer = setInterval(update, 25000);
    document.addEventListener('visibilitychange', update);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', update);
      touch(false);
    };
  }, [id, enabled]);
}
