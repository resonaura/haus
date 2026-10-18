import { deviceDisplayName, deviceSource } from '../../model/device-name';
import { useRef, useState, type CSSProperties } from 'react';
import { Button, Modal, ScrollShadow } from '@heroui/react';
import { ChevronRight, Layers, Power } from 'lucide-react';
import { buildAction, type HausAccessory, type HausAction } from '../../model';
import { deviceAppearance } from '../../model/device-appearance';
import { lightStateDescription } from '../../model/light-profile';
import { lightGroupDescription } from '../../model/room-devices';
import { AccessoryIcon } from '../../components/icons/Icon';
import { ControlRange } from './controls/ControlRange';
import { LightColour } from './controls/LightColour';
import { useDelayedPending } from '../../hooks/useDelayedPending';

export function LightGroupControl({
  accessory,
  theme,
  room,
  onClose,
  onAction,
  onOpenMember,
  onSeparate,
}: {
  accessory: HausAccessory;
  theme: 'light' | 'dark';
  room?: string;
  onClose: () => void;
  onAction: (action: HausAction) => Promise<void>;
  onOpenMember: (member: HausAccessory) => void;
  onSeparate: () => void;
}) {
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(0);
  const [error, setError] = useState('');
  const appearance = deviceAppearance(accessory.state);
  const disabled = accessory.availability !== 'available';
  const syncing = pending || accessory.pending;
  const slowPending = useDelayedPending(Boolean(syncing), accessory.pendingSince);
  const displayName = deviceDisplayName(accessory.name, room, 'Lights');
  const act = async (intent: string, value?: unknown) => {
    ++pendingRef.current;
    setPending(true);
    setError('');
    try {
      await onAction(buildAction(accessory.state, intent, value));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The lights could not be updated.');
    } finally {
      --pendingRef.current;
      setPending(pendingRef.current > 0);
    }
  };
  return (
    <Modal
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Modal.Backdrop variant="blur">
        <Modal.Container placement="center" scroll="inside">
          <Modal.Dialog
            className={`haus-device-modal light-group-dialog is-${theme}`}
            data-active={appearance.active || undefined}
            data-pending={slowPending || undefined}
            style={{ '--device-color': appearance.accent } as CSSProperties}
          >
            <Modal.CloseTrigger className="haus-controller-close" aria-label="Close light group" />
            <Modal.Header className="haus-controller-header">
              <span className="haus-controller-glyph" aria-hidden="true">
                <Layers size={27} />
              </span>
              <span className="haus-controller-room">{room ?? 'Home'} / Light group</span>
              <Modal.Heading>
                {displayName}
                {deviceSource(accessory.name) && (
                  <span className="scene-source-badge scene-source-inline device-source-badge">
                    Hue
                  </span>
                )}
              </Modal.Heading>
              <p className="haus-controller-status">
                {lightGroupDescription(accessory)}
                {slowPending && ' · Updating…'}
              </p>
            </Modal.Header>
            <Modal.Body>
              <ScrollShadow
                className="haus-controller-scroll"
                orientation="vertical"
                size={24}
                hideScrollBar
              >
                <div
                  className="haus-light-controller"
                  style={
                    {
                      '--device-color': appearance.accent,
                      '--accent': appearance.accent,
                    } as CSSProperties
                  }
                >
                  <Button
                    variant="secondary"
                    isDisabled={disabled}
                    aria-busy={syncing}
                    onPress={() => void act('toggle')}
                  >
                    <Power size={17} />
                    {appearance.active ? 'Turn all off' : 'Turn all on'}
                  </Button>
                  {accessory.capabilities.includes('brightness') && (
                    <ControlRange
                      label="Group brightness"
                      value={
                        appearance.active
                          ? Math.round(Number(accessory.state.attributes.brightness ?? 0) / 2.55)
                          : 0
                      }
                      disabled={disabled}
                      onCommit={(value) => void act('brightness', value)}
                    />
                  )}
                  <LightColour
                    entity={accessory.state}
                    capabilities={accessory.capabilities}
                    disabled={disabled}
                    act={(intent, value) => void act(intent, value)}
                  />
                </div>
                <section className="light-group-members" aria-label="Lights in this group">
                  <h3>Individual lights</h3>
                  {accessory.lightGroup?.members.map((member) => (
                    <button
                      key={member.id}
                      className="light-group-member"
                      onClick={() => onOpenMember(member)}
                    >
                      <AccessoryIcon accessory={member} />
                      <span>
                        <strong>{deviceDisplayName(member.name, room, 'Light')}</strong>
                        <small>{lightStateDescription(member.state)}</small>
                      </span>
                      <ChevronRight size={16} />
                    </button>
                  ))}
                </section>
                {error && (
                  <p className="haus-inline-error" role="alert">
                    {error}
                  </p>
                )}
                <div className="light-group-separate">
                  <span>
                    <Layers size={16} /> Grouped automatically
                  </span>
                  <Button variant="secondary" onPress={onSeparate}>
                    Show separately
                  </Button>
                </div>
              </ScrollShadow>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
