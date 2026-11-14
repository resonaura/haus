/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Modal } from '@heroui/react';
import { BrandIcon } from '../../../components/brand/BrandIcon';
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
              <div className="flow-header-top">
                <span className="flow-eyebrow">FINISH CAMERA SETUP</span>
              </div>
              <div className="management-dialog-title">
                <span className="integration-logo">
                  <BrandIcon kind="integration" id="tuya" />
                </span>
                <Modal.Heading>
                  {target.deviceName ? `Finish setup · ${target.deviceName}` : 'Tuya Camera Setup'}
                </Modal.Heading>
              </div>
            </Modal.Header>
            <Modal.Body className="haus-dialog-body">
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
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
