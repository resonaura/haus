import { useMemo, useState } from 'react';
import { Button, Modal } from '@heroui/react';
import { Camera, ChevronRight, Link, Radar } from 'lucide-react';
import type { Snapshot } from '../../model';
import { IntegrationFlow } from './IntegrationFlow';
import { ManualCameraSetup } from './ManualCameraSetup';

const cameraDomains = [
  'generic',
  'onvif',
  'mjpeg',
  'reolink',
  'axis',
  'amcrest',
  'arlo',
  'blink',
  'ring',
  'ezviz',
  'foscam',
  'hikvision',
  'dahua',
  'unifiprotect',
  'eufy_security',
  'tapo',
  'tapo_control',
  'netatmo',
  'nest',
  'tuya',
  'mqtt',
  'homekit_controller',
  'homekit_device',
  'xiaomi_home',
  'xiaomi_miot',
];
export function CameraSetup({
  snapshot,
  onClose,
  onDone,
}: {
  snapshot: Snapshot;
  onClose: () => void;
  onDone: () => void;
}) {
  const [path, setPath] = useState<'integration' | 'manual' | 'existing'>();
  const domains = useMemo(
    () =>
      new Set([
        ...cameraDomains,
        ...snapshot.entities
          .filter((entry) => entry.entity_id.startsWith('camera.'))
          .flatMap((entry) => (entry.platform ? [entry.platform] : [])),
      ]),
    [snapshot.entities],
  );
  if (path === 'integration')
    return (
      <IntegrationFlow
        target={{}}
        domains={domains}
        snapshot={snapshot}
        onClose={onClose}
        onDone={onDone}
      />
    );
  if (path === 'manual' || path === 'existing')
    return (
      <ManualCameraSetup
        snapshot={snapshot}
        existing={path === 'existing'}
        onClose={onClose}
        onDone={onDone}
      />
    );
  const count = snapshot.entities.filter(
    (entry) =>
      entry.entity_id.startsWith('camera.') &&
      !entry.disabled_by &&
      !entry.entity_id.endsWith('_internal'),
  ).length;
  return (
    <Modal
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Modal.Backdrop variant="blur">
        <Modal.Container size="lg">
          <Modal.Dialog className="haus-dialog camera-setup-dialog">
            <Modal.CloseTrigger />
            <Modal.Header>
              <span className="flow-eyebrow">ADD CAMERA</span>
              <Modal.Heading>A little peace of mind.</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <p className="flow-description">
                Start with your camera’s brand. Haus uses its supported connection, discovery and
                sign-in steps.
              </p>
              <div className="setup-paths">
                <Button
                  variant="secondary"
                  className="setup-path"
                  onPress={() => setPath('integration')}
                >
                  <Radar />
                  <span>
                    <strong>Find a camera</strong>
                    <small>Discovered cameras and supported brands</small>
                  </span>
                  <ChevronRight />
                </Button>
                {!!count && (
                  <Button
                    variant="secondary"
                    className="setup-path"
                    onPress={() => setPath('existing')}
                  >
                    <Camera />
                    <span>
                      <strong>Use an existing camera</strong>
                      <small>Choose from {count} cameras already in your home</small>
                    </span>
                    <ChevronRight />
                  </Button>
                )}
                <Button
                  variant="secondary"
                  className="setup-path"
                  onPress={() => setPath('manual')}
                >
                  <Link />
                  <span>
                    <strong>Connect with an address</strong>
                    <small>RTSP, a snapshot URL, or existing source entities</small>
                  </span>
                  <ChevronRight />
                </Button>
              </div>
              <p className="management-hint">
                New cameras start in Stream only. You can enable local event recording in camera
                settings.
              </p>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" onPress={onClose}>
                Cancel
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
