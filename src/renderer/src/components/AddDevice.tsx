import { Button, Modal } from '@heroui/react';
import { Server } from 'lucide-react';
import type { Snapshot } from '../model';
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
  if (!demo)
    return <IntegrationFlow target={{}} snapshot={snapshot} onClose={onClose} onDone={onDone} />;
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
