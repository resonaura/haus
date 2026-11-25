/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { HomeAssistantConnection } from '../../main/connection.js';
import { HUB_PAIRING_REQUIRED, type HubConnection } from '../../main/hub/connection.js';
import { HubCredentialSaveError } from '../../main/hub-session.js';
import { normalizeServerUrl } from '../../main/validation.js';
import type { NativeSession } from '../../shared/native.js';
import type { GpuiHomeState } from './ha-bridge.js';

interface ConnectionPorts {
  state: () => GpuiHomeState;
  update: (patch: Partial<GpuiHomeState>) => void;
  cancelDiscovery: () => void;
  stopPreferenceSync: () => void;
  loadHome: (session: NativeSession, kind: GpuiHomeState['sessionKind']) => Promise<void>;
  hub: Pick<HubConnection, 'connect' | 'disconnect'>;
  ha?: Pick<HomeAssistantConnection, 'connect' | 'disconnect'>;
}

export async function connectHome(
  { address, code, explicitHa }: { address: string; code?: string; explicitHa: boolean },
  { state, update, cancelDiscovery, stopPreferenceSync, loadHome, hub, ha }: ConnectionPorts,
): Promise<void> {
  const kind = explicitHa ? 'home-assistant' : 'haus-hub';
  const current = state();
  if (current.session?.url === address && current.sessionKind === kind) return;
  let url: string;
  try {
    url = normalizeServerUrl(address, explicitHa ? 'Home Assistant' : 'Haus Hub');
  } catch {
    update({
      error: explicitHa
        ? 'Enter the Home Assistant base address. Use HTTPS outside the local network.'
        : 'Enter the Haus Hub base address. Use HTTPS outside the local network.',
    });
    return;
  }

  cancelDiscovery();
  if (explicitHa) {
    if (!ha) {
      update({ error: 'Home Assistant sign-in requires a browser launch handler.' });
      return;
    }
    const session = await ha.connect(url);
    if (state().sessionKind === 'haus-hub') await hub.disconnect().catch(() => undefined);
    stopPreferenceSync();
    update({ pairingUrl: null, sessionKind: kind, preferenceStatus: 'offline' });
    await loadHome(session, kind);
    return;
  }

  if (code && state().pairingUrl !== url) return;
  try {
    const session = await hub.connect(url, code);
    if (ha && state().sessionKind === 'home-assistant')
      await ha.disconnect().catch(() => undefined);
    update({ pairingUrl: null, sessionKind: kind });
    await loadHome(session, kind);
  } catch (error) {
    if (error instanceof Error && error.message === HUB_PAIRING_REQUIRED) {
      update({ pairingUrl: url });
      return;
    }
    update({ pairingUrl: null });
    if (
      error instanceof HubCredentialSaveError ||
      (error instanceof Error && error.message === 'That pairing code is not correct. Start again.')
    ) {
      update({ error: error.message });
      return;
    }
    throw error;
  }
}
