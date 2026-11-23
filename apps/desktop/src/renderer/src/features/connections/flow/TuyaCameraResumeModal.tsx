/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useState } from 'react';
import { Box, HausModalOverlay as Modal, Text } from '@haus/ui';
import { BrandIcon } from '../../../components/brand/BrandIcon';
import { TuyaBridgeQrStep } from './TuyaBridgeQrStep';
import { TuyaCameraFollowup } from './TuyaCameraFollowup';
import { notifyPendingTuyaCamerasChanged, type TuyaPendingCamera } from './tuya-camera-pending';

export function TuyaCameraResumeModal({
  target,
  entryTitle,
  onCompleted,
  onClose,
}: {
  target: TuyaPendingCamera;
  entryTitle?: string;
  onCompleted?: () => void;
  onClose: () => void;
}) {
  const [qrBusy, setQrBusy] = useState(false);
  const [qrError, setQrError] = useState('');
  const directQr = target.reason === 'bridge_session_expired' && Boolean(target.bridgeId);
  return (
    <Modal
      isOpen
      onOpenChange={(open) => {
        if (!open) {
          notifyPendingTuyaCamerasChanged();
          onClose();
        }
      }}
    >
      <Modal.Backdrop variant="blur">
        <Modal.Container size="lg">
          <Modal.Dialog className="haus-dialog integration-flow-dialog">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Box className="flow-header-top">
                <Text className="flow-eyebrow">
                  {directQr ? 'TUYA SESSION EXPIRED' : 'FINISH CAMERA SETUP'}
                </Text>
              </Box>
              <Box className="management-dialog-title">
                <Text className="integration-logo">
                  <BrandIcon kind="integration" id="tuya" />
                </Text>
                <Modal.Heading>
                  {directQr
                    ? `Reconnect · ${target.deviceName || 'Tuya Camera'}`
                    : target.deviceName
                      ? `Finish setup · ${target.deviceName}`
                      : 'Tuya Camera Setup'}
                </Modal.Heading>
              </Box>
            </Modal.Header>
            <Modal.Body className="haus-dialog-body">
              {directQr && target.bridgeId ? (
                <>
                  {qrError && (
                    <Text semantic="p" role="alert" className="form-error">
                      {qrError}
                    </Text>
                  )}
                  <TuyaBridgeQrStep
                    isHub
                    bridgeId={target.bridgeId}
                    busy={qrBusy}
                    onCamerasReady={async () => {
                      setQrBusy(true);
                      try {
                        notifyPendingTuyaCamerasChanged();
                        onCompleted?.();
                        onClose();
                      } finally {
                        setQrBusy(false);
                      }
                    }}
                    onError={setQrError}
                    onCancel={onClose}
                  />
                </>
              ) : (
                <TuyaCameraFollowup
                  entryId={target.entryId}
                  entryTitle={entryTitle || 'Tuya'}
                  resumed
                  focusDeviceName={target.deviceName}
                  onNoCameras={() => {
                    notifyPendingTuyaCamerasChanged();
                    onCompleted?.();
                    onClose();
                  }}
                  onComplete={() => {
                    notifyPendingTuyaCamerasChanged();
                    onCompleted?.();
                  }}
                  onCancel={onClose}
                />
              )}
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
