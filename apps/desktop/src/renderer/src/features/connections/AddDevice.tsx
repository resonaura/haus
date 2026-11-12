/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useState } from 'react';
import { Button, Modal } from '@heroui/react';
import { Camera, ChevronRight, Lamp, QrCode, Server } from 'lucide-react';
import { CameraSetup } from './CameraSetup';
import type { Snapshot } from '../../model';
import { IntegrationFlow } from './IntegrationFlow';
import { CodeFirstCommissioningDialog } from '../commissioning';

export function AddDeviceFlow({
  snapshot,
  demo,
  onClose,
  onConnect,
  onDone,
  onApps,
}: {
  snapshot: Snapshot;
  demo: boolean;
  onClose: () => void;
  onConnect: () => void;
  onDone: () => void;
  onApps: () => void;
}) {
  const [kind, setKind] = useState<'code' | 'camera' | 'other'>();
  if (!demo && kind === 'code')
    return (
      <CodeFirstCommissioningDialog
        snapshot={snapshot}
        onClose={onClose}
        onDone={onDone}
      />
    );
  if (!demo && kind === 'camera')
    return <CameraSetup snapshot={snapshot} onClose={onClose} onDone={onDone} onApps={onApps} />;
  if (!demo && kind === 'other')
    return <IntegrationFlow target={{}} snapshot={snapshot} onClose={onClose} onDone={onDone} />;
  if (!demo)
    return (
      <Modal
        isOpen
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <Modal.Backdrop variant="blur">
          <Modal.Container>
            <Modal.Dialog className="haus-dialog">
              <Modal.CloseTrigger />
              <Modal.Header>
                <Modal.Heading>What are we adding?</Modal.Heading>
              </Modal.Header>
              <Modal.Body>
                <div className="setup-paths">
                  <Button
                    variant="secondary"
                    className="setup-path"
                    onPress={() => setKind('code')}
                  >
                    <QrCode />
                    <span>
                      <strong>Set up with code</strong>
                      <small>Matter QR, HomeKit PIN, Improv, or Wi-Fi</small>
                    </span>
                    <ChevronRight />
                  </Button>
                  <Button
                    variant="secondary"
                    className="setup-path"
                    onPress={() => setKind('camera')}
                  >
                    <Camera />
                    <span>
                      <strong>Camera</strong>
                      <small>Live video, recording and activity</small>
                    </span>
                    <ChevronRight />
                  </Button>
                  <Button
                    variant="secondary"
                    className="setup-path"
                    onPress={() => setKind('other')}
                  >
                    <Lamp />
                    <span>
                      <strong>Other integration</strong>
                      <small>Bridges, services, and legacy discovery</small>
                    </span>
                    <ChevronRight />
                  </Button>
                </div>
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    );
  return (
    <Modal
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Modal.Backdrop variant="blur">
        <Modal.Container>
          <Modal.Dialog className="haus-dialog">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>Connect your home first</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <div className="flow-prepare">
                <Server size={34} />
                <p>Connect Home Assistant to discover devices and complete setup in Haus.</p>
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" onPress={onClose}>
                Cancel
              </Button>
              <Button
                onPress={() => {
                  onClose();
                  onConnect();
                }}
              >
                Connect Home Assistant
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
