/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Box, HausButton, Text } from '@haus/ui';
import { AlertTriangle, Download, Link, LoaderCircle, Play } from 'lucide-react';
import type { TuyaAddonCandidate, TuyaStandaloneBridgeState } from './tuya-cameras';

export function TuyaBridgeSetupStep({
  addon,
  standaloneBridge,
  installStatus,
  busy,
  onInstallOrStart,
  onManualPair,
  onCancel,
}: {
  addon?: TuyaAddonCandidate;
  standaloneBridge?: TuyaStandaloneBridgeState;
  installStatus: string;
  busy: boolean;
  onInstallOrStart: () => void;
  onManualPair: () => void;
  onCancel: () => void;
}) {
  const renderDescription = () => {
    if (standaloneBridge) {
      if (!standaloneBridge.installed) {
        return 'Haus can automatically install the latest Tuya Camera Bridge container (host network access required for LAN P2P/RTSP streaming and loopback auto-pairing), then guide you through the second Tuya QR sign-in right here.';
      }
      if (!standaloneBridge.running) {
        return `Tuya Camera Bridge${standaloneBridge.version ? ` (v${standaloneBridge.version})` : ''} is installed on this Hub, but stopped. Start it to auto-pair and sign in for camera streams.`;
      }
      return 'Tuya Camera Bridge is running on this Hub. Connect to it to complete the second Tuya QR sign-in for camera streams.';
    }
    if (addon) {
      return addon.installed
        ? `The ${addon.name} add-on is installed on Home Assistant, but currently stopped. Start it, then complete the second Tuya QR sign-in for camera streams.`
        : `Install ${addon.name} on Home Assistant and complete a second Tuya QR sign-in to stream P2P/RTSP video natively in Haus.`;
    }
    return 'Install or start the Tuya RTSP/Camera Bridge, complete its second Tuya QR login, and pair its address below.';
  };

  const renderPrimaryLabel = () => {
    if (standaloneBridge) {
      if (!standaloneBridge.installed) return 'Install latest camera bridge';
      if (!standaloneBridge.running) return 'Start camera bridge';
      return 'Connect camera bridge';
    }
    if (addon) {
      return addon.installed ? 'Start camera bridge' : 'Install camera bridge';
    }
    return null;
  };

  const primaryLabel = renderPrimaryLabel();

  return (
    <Box className="tuya-followup-step">
      <Box className="flow-warning-box" role="note">
        <AlertTriangle size={18} />
        <Box>
          <Text semantic="strong">Tuya Camera Bridge needed</Text>
          <Text semantic="p">{renderDescription()}</Text>
        </Box>
      </Box>

      {installStatus && (
        <Box className="tuya-install-progress" role="status" ariaLive="polite">
          <LoaderCircle size={15} className="spin" />
          <Text>{installStatus}</Text>
        </Box>
      )}

      <Box className="tuya-followup-actions">
        <HausButton variant="ghost" isDisabled={busy} onPress={onCancel}>
          Finish without cameras
        </HausButton>
        <HausButton variant="secondary" isDisabled={busy} onPress={onManualPair}>
          <Link size={14} />
          Pair bridge manually
        </HausButton>
        {primaryLabel && (
          <HausButton isPending={busy} isDisabled={busy} onPress={onInstallOrStart}>
            {standaloneBridge?.installed === false || addon?.installed === false ? (
              <Download size={14} />
            ) : (
              <Play size={14} />
            )}
            {primaryLabel}
          </HausButton>
        )}
      </Box>
    </Box>
  );
}
