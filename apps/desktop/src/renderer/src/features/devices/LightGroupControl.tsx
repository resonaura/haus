/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { deviceDisplayName, deviceSource } from '../../model/device-name';
import { useRef, useState } from 'react';
import {
  Box,
  HausButton as Button,
  HausModalOverlay as Modal,
  HausScrollArea as ScrollShadow,
  Heading,
  Pressable,
  Text,
} from '@haus/ui';
import { ChevronRight, Layers, Power } from 'lucide-react';
import { buildAction, type HausAccessory, type HausAction } from '../../model';
import { deviceAppearance, deviceSurfaceVars } from '../../model/device-appearance';
import { lightStateDescription } from '../../model/light-profile';
import { lightGroupDescription } from '../../model/room-devices';
import { AccessoryIcon } from '../../components/icons/Icon';
import { HausIdCode } from '../../components/ui/haus-id';
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
            data-light-effect={appearance.effect?.motion}
            surfaceTokens={deviceSurfaceVars(appearance.accent, appearance.effect)}
          >
            <Modal.CloseTrigger className="haus-controller-close" aria-label="Close light group" />
            <Modal.Header className="haus-controller-header">
              <Text className="haus-controller-glyph" ariaHidden>
                <Layers size={27} />
              </Text>
              <Text className="haus-controller-room">{room ?? 'Home'} / Light group</Text>
              <Modal.Heading>
                {displayName}
                {deviceSource(accessory.name) && (
                  <Text className="scene-source-badge scene-source-inline device-source-badge">
                    Hue
                  </Text>
                )}
              </Modal.Heading>
              <Text semantic="p" className="haus-controller-status">
                {lightGroupDescription(accessory)}
                {slowPending && ' · Updating…'}
              </Text>
            </Modal.Header>
            <Modal.Body>
              <ScrollShadow
                className="haus-controller-scroll"
                orientation="vertical"
                size={24}
                hideScrollBar
              >
                <Box
                  className="haus-light-controller"
                  dataAttrs={{ 'data-light-effect': appearance.effect?.motion }}
                  surfaceTokens={deviceSurfaceVars(appearance.accent, appearance.effect, true)}
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
                </Box>
                <Box
                  semantic="section"
                  className="light-group-members"
                  ariaLabel="Lights in this group"
                >
                  <Heading level={3}>Individual lights</Heading>
                  {accessory.lightGroup?.members.map((member) => (
                    <Pressable
                      key={member.id}
                      className="light-group-member"
                      onPress={() => onOpenMember(member)}
                    >
                      <AccessoryIcon accessory={member} />
                      <Text>
                        <Text semantic="strong">
                          {deviceDisplayName(member.name, room, 'Light')}
                        </Text>
                        <Text semantic="small">{lightStateDescription(member.state)}</Text>
                        {member.hausId && (
                          <Text semantic="small" className="haus-id-inline">
                            <HausIdCode value={member.hausId} />
                          </Text>
                        )}
                      </Text>
                      <ChevronRight size={16} />
                    </Pressable>
                  ))}
                </Box>
                {error && (
                  <Text semantic="p" className="haus-inline-error" role="alert">
                    {error}
                  </Text>
                )}
                <Box className="light-group-separate">
                  <Text>
                    <Layers size={16} /> Grouped automatically
                  </Text>
                  <Button variant="secondary" onPress={onSeparate}>
                    Show separately
                  </Button>
                </Box>
              </ScrollShadow>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
