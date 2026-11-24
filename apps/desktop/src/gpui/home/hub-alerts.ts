/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import {
  AlertsMonitor,
  type AlertsTransport,
  type HomeNotice,
  type TransportEntityState,
} from '@haus/core/transport';

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

  const notices: HomeNotice[] = demo ? [] : monitor.noticesFor(states, demo);

  return {
    notices,
    error: state.error,
    activePairing: demo ? null : state.activePairing,
    dismissNotice: (notificationId: string) => monitor.dismissNotice(notificationId),
    dismissPairing: (sessionId: string) => monitor.dismissPairing(sessionId),
    refresh: () => monitor.refresh(),
  };
}
