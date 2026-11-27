/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import {
  AlertsMonitor,
  type AlertsTransport,
  type HomeNotice,
  type TransportEntityState,
} from '@haus/core/transport';

const EMPTY_NOTICES: readonly HomeNotice[] = [];

export function useGpuiAlerts({
  transport,
  states,
  demo,
}: {
  readonly transport?: AlertsTransport;
  readonly states: readonly TransportEntityState[];
  readonly demo?: boolean;
}) {
  const monitor = useMemo(() => new AlertsMonitor(), []);
  const state = useSyncExternalStore(monitor.subscribe, monitor.getSnapshot);

  useEffect(() => {
    if (demo || !transport?.connected) {
      monitor.setTransport(undefined);
      monitor.stop();
      return;
    }
    monitor.setTransport(transport);
    return monitor.start(4000);
  }, [demo, monitor, transport]);

  const notices = useMemo<readonly HomeNotice[]>(
    () => (demo ? EMPTY_NOTICES : monitor.noticesFor(states, demo)),
    [demo, monitor, states, state],
  );
  const dismissNotice = useCallback(
    (notificationId: string) => monitor.dismissNotice(notificationId),
    [monitor],
  );
  const dismissPairing = useCallback(
    (sessionId: string) => monitor.dismissPairing(sessionId),
    [monitor],
  );
  const refresh = useCallback(() => monitor.refresh(), [monitor]);

  return {
    notices,
    error: state.error,
    activePairing: demo ? null : state.activePairing,
    dismissNotice,
    dismissPairing,
    refresh,
  };
}
