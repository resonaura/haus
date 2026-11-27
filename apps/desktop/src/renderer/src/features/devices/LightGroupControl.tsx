/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useRef, useState } from 'react';
import {
  LIGHT_COLOUR_PRESETS,
  hsvToRgb,
  rgbToHsv,
} from '@haus/core/transport';
import {
  lightActiveEffect,
  lightColor,
  lightDisableEffect,
  lightEffectOptions,
  lightProfile,
  lightStateDescription,
  lightTemperature,
} from '@haus/core/optimistic';
import {
  HausModalOverlay as Modal,
  HausScrollArea as ScrollShadow,
  Text,
} from '@haus/ui';
import { LightModalPanel } from '@haus/ui/components';
import { Layers } from 'lucide-react';
import { buildAction, type HausAccessory, type HausAction } from '../../model';
import { deviceAppearance, deviceSurfaceVars } from '../../model/device-appearance';
import { deviceDisplayName, deviceSource } from '../../model/device-name';
import { lightGroupDescription } from '../../model/room-devices';
import { useDelayedPending } from '../../hooks/useDelayedPending';

function resolveGroupRgb(entity: HausAccessory['state']): [number, number, number] {
  const css = lightColor(entity);
  if (css) {
    const match = /rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/.exec(css);
    if (match) return [Number(match[1]), Number(match[2]), Number(match[3])];
  }
  const raw = entity.attributes.rgb_color;
  if (Array.isArray(raw) && raw.length >= 3 && raw.every((c) => typeof c === 'number')) {
    return [Math.round(raw[0]), Math.round(raw[1]), Math.round(raw[2])];
  }
  return [255, 224, 178];
}

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
  const entity = accessory.state;
  const profile = lightProfile(entity);
  const rgb = resolveGroupRgb(entity);
  const hs = Array.isArray(entity.attributes.hs_color) ? entity.attributes.hs_color : undefined;
  const [hsvH, hsvS] =
    hs && hs.length >= 2 && typeof hs[0] === 'number' && typeof hs[1] === 'number'
      ? [Math.round(hs[0]), Math.round(hs[1])]
      : rgbToHsv(rgb[0], rgb[1], rgb[2]);

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

  const members = accessory.lightGroup?.members ?? [];

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
                <LightModalPanel
                  idPrefix={`group-${accessory.id}`}
                  deviceName={displayName}
                  active={appearance.active}
                  stateSubtitle={lightGroupDescription(accessory)}
                  brightnessPct={
                    appearance.active
                      ? Math.round(Number(entity.attributes.brightness ?? 0) / 2.55)
                      : 0
                  }
                  rgb={rgb}
                  hue={hsvH}
                  saturation={hsvS}
                  kelvin={lightTemperature(entity)}
                  minKelvin={
                    typeof entity.attributes.min_color_temp_kelvin === 'number'
                      ? entity.attributes.min_color_temp_kelvin
                      : 2000
                  }
                  maxKelvin={
                    typeof entity.attributes.max_color_temp_kelvin === 'number'
                      ? entity.attributes.max_color_temp_kelvin
                      : 6500
                  }
                  canToggle={accessory.capabilities.includes('toggle')}
                  canBrightness={accessory.capabilities.includes('brightness')}
                  canColor={profile.color && accessory.capabilities.includes('color')}
                  canTemperature={profile.temperature && accessory.capabilities.includes('temperature')}
                  effects={
                    accessory.capabilities.includes('effect') ? lightEffectOptions(entity) : []
                  }
                  activeEffect={lightActiveEffect(entity)}
                  stopEffect={lightDisableEffect(entity)}
                  groupMembers={members.map((m) => ({
                    id: m.id,
                    name: deviceDisplayName(m.name, room, 'Light'),
                    state: lightStateDescription(m.state),
                  }))}
                  disabled={disabled}
                  presets={LIGHT_COLOUR_PRESETS}
                  onToggle={() => void act('toggle')}
                  onBrightness={(next) => void act('brightness', next)}
                  onColorRgb={(nextRgb) => void act('color', nextRgb)}
                  onColorHsv={(nextHue, nextSat) => void act('color', hsvToRgb(nextHue, nextSat))}
                  onTemperature={(nextKelvin) => void act('temperature', nextKelvin)}
                  onSelectEffect={(effect) => void act('effect', effect)}
                  onOpenMember={(memberId) => {
                    const found = members.find((m) => m.id === memberId);
                    if (found) onOpenMember(found);
                  }}
                  onSeparateGroup={onSeparate}
                />
                {error && (
                  <Text semantic="p" className="haus-inline-error" role="alert">
                    {error}
                  </Text>
                )}
              </ScrollShadow>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
