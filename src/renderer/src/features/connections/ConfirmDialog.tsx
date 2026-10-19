import { Button, Modal } from '@heroui/react';
import type { Confirmation } from './ManagementFeedback';
export function ConfirmDialog({
  confirmation,
  busy,
  onClose,
  onConfirm,
}: {
  confirmation: Confirmation;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
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
              <Modal.Heading>{confirmation.title}</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <p className="flow-description">{confirmation.description}</p>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" onPress={onClose}>
                Cancel
              </Button>
              <Button
                variant={confirmation.danger ? 'danger' : 'primary'}
                isDisabled={busy}
                onPress={onConfirm}
              >
                {confirmation.label}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
