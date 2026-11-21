/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useState } from 'react';
import { Button, Modal } from '@heroui/react';
import { QrCode } from 'lucide-react';
import type { HassEntity } from '../../../model';
import { BrandIcon } from '../../../components/brand/BrandIcon';
import { TuyaBridgeQrStep } from '../../connections/flow/TuyaBridgeQrStep';
import { notifyPendingTuyaCamerasChanged } from '../../connections/flow/tuya-camera-pending';
import './reconnect.scss';

export interface TuyaCameraReconnectTarget {
  readonly bridgeId: string;
  readonly cameraName: string;
}

/** Extracts the Tuya bridge reconnect target when a camera is offline due to an expired session. */
export function tuyaReconnectTargetForEntity(entity: HassEntity): TuyaCameraReconnectTarget | null {
  const attrs = entity.attributes as Record<string, unknown>;
  if (attrs.haus_bridge_provider !== 'tuya' || attrs.haus_auth_expired !== true) return null;
  const bridgeId = typeof attrs.haus_bridge_id === 'string' ? attrs.haus_bridge_id.trim() : '';
  if (!bridgeId) return null;
  return {
    bridgeId,
    cameraName: String(attrs.friendly_name ?? 'Tuya Camera'),
  };
}

/** Fast 1-click QR reconnect dialog for an expired Tuya Camera Bridge session. */
export function TuyaCameraReconnectModal({
  target,
  onReconnected,
  onClose,
}: {
  target: TuyaCameraReconnectTarget;
  onReconnected?: () => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  return (
    <Modal
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Modal.Backdrop variant="blur">
        <Modal.Container size="lg">
          <Modal.Dialog className="haus-dialog integration-flow-dialog">
            <Modal.CloseTrigger />
            <Modal.Header>
              <div className="flow-header-top">
                <span className="flow-eyebrow">TUYA SESSION EXPIRED</span>
              </div>
              <div className="management-dialog-title">
                <span className="integration-logo">
                  <BrandIcon kind="integration" id="tuya" />
                </span>
                <Modal.Heading>Reconnect {target.cameraName}</Modal.Heading>
              </div>
            </Modal.Header>
            <Modal.Body className="haus-dialog-body">
              {error && (
                <p role="alert" className="form-error">
                  {error}
                </p>
              )}
              <TuyaBridgeQrStep
                isHub
                bridgeId={target.bridgeId}
                busy={busy}
                onCamerasReady={async () => {
                  setBusy(true);
                  try {
                    notifyPendingTuyaCamerasChanged();
                    onReconnected?.();
                    onClose();
                  } finally {
                    setBusy(false);
                  }
                }}
                onError={setError}
                onCancel={onClose}
              />
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

/** Compact trigger button rendered in CameraModal's offline alert bar when Tuya session expires. */
export function CameraTuyaReconnectAction({
  entity,
  onReconnected,
}: {
  entity: HassEntity;
  onReconnected: () => void;
}) {
  const [open, setOpen] = useState(false);
  const target = tuyaReconnectTargetForEntity(entity);
  if (!target) return null;
  return (
    <>
      <Button size="sm" variant="primary" onPress={() => setOpen(true)}>
        <QrCode size={15} />
        Reconnect QR
      </Button>
      {open && (
        <TuyaCameraReconnectModal
          target={target}
          onReconnected={onReconnected}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
