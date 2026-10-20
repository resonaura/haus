import { useState } from 'react';
import { Button, Modal } from '@heroui/react';
import { Camera, ChevronRight, Lamp, Server } from 'lucide-react';
import { CameraSetup } from './CameraSetup';
import type { Snapshot } from '../../model';
import { IntegrationFlow } from './IntegrationFlow';

export function AddDeviceFlow({
  snapshot,
  demo,
  onClose,
  onConnect,
  onDone,
}: {
  snapshot: Snapshot;
  demo: boolean;
  onClose: () => void;
  onConnect: () => void;
  onDone: () => void;
}) {
  const [kind, setKind] = useState<'camera' | 'other'>();
  if (!demo && kind === 'camera')
    return <CameraSetup snapshot={snapshot} onClose={onClose} onDone={onDone} />;
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
                      <strong>Other device</strong>
                      <small>Lights, sensors, speakers and more</small>
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
