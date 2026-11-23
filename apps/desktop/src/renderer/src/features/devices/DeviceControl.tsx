/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { NetworkDetails } from './NetworkDetails';
import { DeviceFirmwareSection } from './network/FirmwareUpdateCard';
import { MediaRemote } from './MediaRemote';
import { ButtonController } from './ButtonController';
import { PowerStripControls } from './PowerStripControls';
import { PrinterSupplies } from './PrinterSupplies';
import { DeviceHistory } from '../statistics/DeviceHistory';
import { PrimaryControls } from './controls/PrimaryControls';
import { Glyph } from './controls/ControlGlyph';
import { AccessoryDetails } from './AccessoryDetails';
import { deviceControlDomains, humanize } from './controls/control-values';
import { AccessoryIcon } from '../../components/icons/Icon';
import { deviceSource } from '../../model/device-name';
import { accessoryDisplayName } from '../../model/accessory-name';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Eye, EyeOff, RefreshCw } from 'lucide-react';
import {
  Box,
  HausButton as Button,
  HausCode,
  HausDisclosure,
  HausForm,
  HausModalOverlay as Modal,
  HausScrollArea as ScrollShadow,
  HausTabsView as Tabs,
  Heading,
  SelectInput,
  Text,
  TextArea,
  TextInput,
} from '@haus/ui';
import { buildAction, isSegmentEntity, type HausAccessory, type Snapshot } from '../../model';
import { projectAccessoryEntity } from '../../model/categories';
import { lightStateDescription } from '../../model/light-profile';
import {
  binaryStateDescription,
  deviceAppearance,
  deviceSurfaceVars,
} from '../../model/device-appearance';
import { useDelayedPending } from '../../hooks/useDelayedPending';
import { heaterModeLabel, isKettle, kettleRefreshEntity } from '../../model/water-heater';
import { KettleEntityIdentity } from './KettleEntityIdentity';

type Action = ReturnType<typeof buildAction>;
type Intent = Parameters<typeof buildAction>[1];
type Value = Parameters<typeof buildAction>[2];

export interface DeviceControlProps {
  accessory: HausAccessory;
  snapshot: Snapshot;
  favorite: boolean;
  demo: boolean;
  initialEntityId?: string;
  theme: 'light' | 'dark';
  hiddenFromHome: boolean;
  hiddenFromApp: boolean;
  onClose: () => void;
  onAction: (action: Action) => Promise<void>;
  onFavorite: () => void;
  onToggleHomeVisibility: () => void;
  onToggleAppVisibility: () => void;
  onMove: (areaId: string) => Promise<void>;
  onRename: (name: string) => Promise<void>;
}

export function DeviceControl({
  accessory,
  snapshot,
  favorite,
  demo,
  initialEntityId,
  theme,
  hiddenFromHome,
  hiddenFromApp,
  onClose,
  onAction,
  onFavorite,
  onToggleHomeVisibility,
  onToggleAppVisibility,
  onMove,
  onRename,
}: DeviceControlProps) {
  const kettle = isKettle(accessory);
  const refreshEntity = kettleRefreshEntity(accessory, snapshot);
  const controlEntities = useMemo(() => {
    const registry = new Map(snapshot.entities.map((entry) => [entry.entity_id, entry]));
    const related = accessory.secondaryEntities.filter((item) => {
      if (
        kettle &&
        accessory.primaryEntityId.startsWith('water_heater.') &&
        (item.entity_id.startsWith('water_heater.') ||
          /^button\..*_(boil|stop)$/.test(item.entity_id))
      )
        return false;
      const entry = registry.get(item.entity_id);
      return (
        (deviceControlDomains.has(item.entity_id.split('.')[0]) ||
          item.entity_id === initialEntityId) &&
        !entry?.disabled_by &&
        !entry?.hidden_by &&
        !entry?.entity_category &&
        !isSegmentEntity(item)
      );
    });
    const controls = [accessory.state, ...related];
    const nonCameraControls = controls.filter((item) => item.entity_id.split('.')[0] !== 'camera');
    return nonCameraControls.length ? nonCameraControls : controls;
  }, [accessory, initialEntityId, kettle, snapshot.entities]);
  const [selectedEntityId, setSelectedEntityId] = useState(
    initialEntityId ?? accessory.primaryEntityId,
  );
  const entity =
    controlEntities.find((item) => item.entity_id === selectedEntityId) ?? accessory.state;
  useEffect(() => {
    if (!controlEntities.some((item) => item.entity_id === selectedEntityId))
      setSelectedEntityId(accessory.primaryEntityId);
  }, [accessory.primaryEntityId, controlEntities, selectedEntityId]);
  const attrs = entity.attributes;
  const domain = entity.entity_id.split('.')[0];
  const appleTv =
    domain === 'media_player' &&
    /apple\s*tv|tvos/i.test(`${accessory.model ?? ''} ${accessory.name}`);
  const hasRemote =
    appleTv &&
    Boolean(snapshot.services.remote?.send_command) &&
    accessory.secondaryEntities.some(
      (item) =>
        item.entity_id.startsWith('remote.') &&
        !snapshot.entities.find((entry) => entry.entity_id === item.entity_id)?.disabled_by,
    );
  const isWide =
    domain === 'media_player' ||
    accessory.category === 'network' ||
    accessory.category === 'printers' ||
    accessory.powerStrip ||
    accessory.buttonController ||
    kettle ||
    controlEntities.length > 2;
  const expanded = kettle || domain === 'media_player' || accessory.category === 'network';
  const appearance = deviceAppearance(entity);
  const isStatelessAction = ['scene', 'button', 'input_button', 'event'].includes(domain);
  const unavailable =
    entity.state === 'unavailable' || (entity.state === 'unknown' && !isStatelessAction);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [name, setName] = useState(accessory.name);
  const [room, setRoom] = useState(accessory.areaId ?? '');
  const [service, setService] = useState('');
  const [serviceData, setServiceData] = useState('{}');
  const syncing = snapshot.pendingEntityIds?.includes(entity.entity_id) === true;
  const slowPending = useDelayedPending(
    pending || syncing,
    snapshot.pendingSince?.[entity.entity_id],
  );
  const disabled =
    unavailable ||
    (pending && isStatelessAction) ||
    ['locking', 'unlocking'].includes(entity.state);
  const area = snapshot.areas.find((item) => item.area_id === accessory.areaId);
  const deviceKind = kettle
    ? 'Kettle'
    : accessory.physicalHub
      ? 'Hub'
      : accessory.buttonController
        ? 'Wireless remote'
        : accessory.powerStrip
          ? 'Power strip'
          : accessory.category === 'network'
            ? 'Network'
            : humanize(domain);
  const displayName = accessoryDisplayName(accessory, area?.name);
  const availableServices = Object.keys(snapshot.services[domain] ?? {}).sort();
  const request = async (operation: () => Promise<void>, success = '', allowConcurrent = false) => {
    if (pendingRef.current && !allowConcurrent) return;
    ++pendingRef.current;
    setPending(true);
    setError('');
    setNotice('');
    try {
      await operation();
      setNotice(success);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'This action could not be completed. Please try again.',
      );
    } finally {
      --pendingRef.current;
      setPending(pendingRef.current > 0);
    }
  };
  const act = (intent: Intent, value?: Value) => {
    void request(
      () => onAction(buildAction(entity, intent, value)),
      undefined,
      !['lock', 'unlock', 'press', 'run'].includes(intent),
    );
  };
  const explicitService = (serviceName: string, data?: Record<string, unknown>) => {
    void request(
      () =>
        onAction({
          domain,
          service: serviceName,
          target: { entity_id: entity.entity_id },
          service_data: data,
        }),
      undefined,
      true,
    );
  };
  return (
    <Modal.Backdrop
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      variant="blur"
      className="haus-controller-backdrop"
    >
      <Modal.Container placement="center" scroll="inside">
        <Modal.Dialog
          className={`haus-device-modal is-${theme} ${isWide ? 'is-wide' : ''} ${expanded ? 'is-expanded' : ''}`}
          data-controller-kind={kettle ? 'kettle' : domain}
          data-active={appearance.active || undefined}
          data-pending={slowPending || undefined}
          data-light-effect={appearance.effect?.motion}
          surfaceTokens={deviceSurfaceVars(appearance.accent, appearance.effect)}
        >
          <Modal.CloseTrigger
            className="haus-controller-close"
            aria-label="Close device controller"
          />
          <Button
            isIconOnly
            variant="ghost"
            className="haus-controller-favorite"
            aria-label={favorite ? 'Remove from Favorites' : 'Add to Favorites'}
            aria-pressed={favorite}
            onPress={onFavorite}
          >
            <Glyph name="star" />
          </Button>
          <Modal.Header className="haus-controller-header">
            <Text className="haus-controller-glyph" ariaHidden>
              <AccessoryIcon accessory={projectAccessoryEntity(accessory, entity)} size={27} />
            </Text>
            <Text className="haus-controller-room">
              {area?.name ?? 'My Home'} <Text> / </Text>
              {deviceKind}
            </Text>
            <Modal.Heading>
              {displayName}
              {deviceSource(accessory.name) && (
                <Text className="scene-source-badge scene-source-inline device-source-badge">
                  Hue
                </Text>
              )}
            </Modal.Heading>
            <Text
              semantic="p"
              className={`haus-controller-status ${unavailable ? 'is-unavailable' : ''}`}
              ariaLive="polite"
            >
              <Text />
              {unavailable
                ? 'No response'
                : isStatelessAction && entity.state === 'unknown'
                  ? 'Ready'
                  : domain === 'light'
                    ? lightStateDescription(entity)
                    : domain === 'water_heater'
                      ? heaterModeLabel(entity.state, kettle)
                      : humanize(entity.state)}
              {slowPending && ' · Updating…'}
            </Text>
          </Modal.Header>
          <Modal.Body className="haus-controller-body">
            <ScrollShadow
              className="haus-controller-scroll"
              orientation="vertical"
              size={28}
              hideScrollBar
            >
              <Tabs className="haus-device-tabs" defaultSelectedKey="control">
                <Tabs.ListContainer>
                  <Tabs.List aria-label="Device panel">
                    <Tabs.Tab id="control">
                      Controls
                      <Tabs.Indicator />
                    </Tabs.Tab>
                    <Tabs.Tab id="history">
                      History
                      <Tabs.Indicator />
                    </Tabs.Tab>
                    <Tabs.Tab id="details">
                      Details
                      <Tabs.Indicator />
                    </Tabs.Tab>
                    <Tabs.Tab id="settings">
                      Settings
                      <Tabs.Indicator />
                    </Tabs.Tab>
                  </Tabs.List>
                </Tabs.ListContainer>
                <Tabs.Panel id="control" className="haus-control-panel">
                  {controlEntities.length > 1 &&
                    !accessory.powerStrip &&
                    !accessory.buttonController &&
                    accessory.category !== 'network' && (
                      <Box
                        semantic="section"
                        className="haus-entity-picker"
                        ariaLabel="Controls for this device"
                      >
                        <Box className="haus-entity-picker-heading">
                          <Heading level={3}>Controls on this device</Heading>
                          <Text>{controlEntities.length}</Text>
                        </Box>
                        <ScrollShadow
                          className="haus-entity-picker-scroll"
                          orientation="horizontal"
                          hideScrollBar
                          size={20}
                        >
                          <Box className="haus-entity-picker-list">
                            {controlEntities.map((item) => (
                              <Button
                                key={item.entity_id}
                                className={`haus-entity-option ${item.entity_id === entity.entity_id ? 'is-selected' : ''}`}
                                variant="ghost"
                                aria-pressed={item.entity_id === entity.entity_id}
                                onPress={() => setSelectedEntityId(item.entity_id)}
                              >
                                <Text>
                                  {String(
                                    item.attributes.friendly_name ??
                                      humanize(item.entity_id.split('.')[1]),
                                  )}
                                </Text>
                                <Text semantic="small">
                                  {humanize(item.entity_id.split('.')[0])}
                                </Text>
                              </Button>
                            ))}
                          </Box>
                        </ScrollShadow>
                      </Box>
                    )}
                  {unavailable && (
                    <Text semantic="p" className="haus-inline-warning">
                      This accessory is unavailable. Controls return when it reports online.
                    </Text>
                  )}
                  {accessory.category !== 'network' && (
                    <DeviceFirmwareSection
                      accessory={accessory}
                      pending={pending}
                      onAction={(action) => void request(() => onAction(action), undefined, true)}
                    />
                  )}
                  {accessory.category === 'printers' && (
                    <PrinterSupplies accessory={accessory} demo={demo} />
                  )}
                  {accessory.category === 'network' ? (
                    <NetworkDetails
                      accessory={accessory}
                      pending={pending}
                      onAction={(action) => void request(() => onAction(action), undefined, true)}
                    />
                  ) : accessory.buttonController ? (
                    <ButtonController accessory={accessory} snapshot={snapshot} demo={demo} />
                  ) : accessory.powerStrip ? (
                    <PowerStripControls
                      entities={controlEntities}
                      name={accessory.name}
                      onAction={(action) => void request(() => onAction(action), undefined, true)}
                    />
                  ) : (
                    <Box className={`haus-primary-content ${hasRemote ? 'has-remote' : ''}`}>
                      <PrimaryControls
                        key={entity.entity_id}
                        accessory={accessory}
                        entity={entity}
                        snapshot={snapshot}
                        disabled={disabled}
                        act={act}
                        explicitService={explicitService}
                      />
                      {refreshEntity && (
                        <Button
                          variant="ghost"
                          className="haus-kettle-refresh"
                          isDisabled={pending || refreshEntity.state === 'unavailable'}
                          onPress={() =>
                            void request(
                              () => onAction(buildAction(refreshEntity, 'press')),
                              'Fresh readings requested.',
                            )
                          }
                        >
                          <RefreshCw size={16} />
                          Refresh readings
                        </Button>
                      )}
                      {hasRemote && (
                        <MediaRemote
                          entities={[accessory.state, ...accessory.secondaryEntities]}
                          snapshot={snapshot}
                          onAction={(action) =>
                            void request(() => onAction(action), undefined, true)
                          }
                        />
                      )}
                    </Box>
                  )}
                </Tabs.Panel>
                <Tabs.Panel id="history" className="haus-detail-panel">
                  <DeviceHistory accessory={accessory} demo={demo} />
                </Tabs.Panel>
                <Tabs.Panel id="details" className="haus-detail-panel">
                  <AccessoryDetails
                    accessory={accessory}
                    entity={entity}
                    snapshot={snapshot}
                    stateLabel={binaryStateDescription(entity) ?? humanize(entity.state)}
                    pending={pending}
                    onSecondaryAction={(action) => {
                      void request(() => onAction(action));
                    }}
                  />
                  <HausDisclosure
                    className="haus-advanced"
                    summary={
                      <>
                        Available actions <Glyph name="chevron" />
                      </>
                    }
                  >
                    <Text semantic="p">Run an action supported by this device domain.</Text>
                    <HausForm
                      onSubmit={() => {
                        void request(async () => {
                          if (!availableServices.includes(service))
                            throw new Error('Choose an available action.');
                          const data: unknown = JSON.parse(serviceData);
                          if (!data || typeof data !== 'object' || Array.isArray(data))
                            throw new Error('Action data must be a JSON object.');
                          await onAction({
                            domain,
                            service,
                            target: { entity_id: entity.entity_id },
                            service_data: data as Record<string, unknown>,
                          });
                        });
                      }}
                    >
                      <Text semantic="label" className="haus-field">
                        Action
                        <SelectInput
                          required
                          value={service}
                          disabled={disabled}
                          options={[
                            { value: '', label: 'Choose an action' },
                            ...availableServices.map((item) => ({
                              value: item,
                              label: humanize(item),
                            })),
                          ]}
                          onChange={setService}
                        />
                      </Text>
                      <Text semantic="label" className="haus-field">
                        Action data (JSON)
                        <TextArea
                          value={serviceData}
                          spellCheck={false}
                          onChange={setServiceData}
                          disabled={disabled}
                        />
                      </Text>
                      <Button
                        type="submit"
                        className="haus-primary-action"
                        isDisabled={disabled || !service}
                      >
                        Run action
                      </Button>
                    </HausForm>
                  </HausDisclosure>
                  <HausDisclosure
                    className="haus-advanced"
                    summary={
                      <>
                        All attributes <Glyph name="chevron" />
                      </>
                    }
                  >
                    <ScrollShadow
                      className="haus-attrs-scroll"
                      orientation="vertical"
                      size={20}
                      hideScrollBar
                    >
                      <HausCode block>{JSON.stringify(attrs, null, 2)}</HausCode>
                    </ScrollShadow>
                  </HausDisclosure>
                </Tabs.Panel>
                <Tabs.Panel id="settings" className="haus-settings-panel">
                  {isKettle(accessory) && (
                    <KettleEntityIdentity accessory={accessory} snapshot={snapshot} />
                  )}
                  <Box semantic="section" className="haus-visibility-settings">
                    <Box className="haus-visibility-heading">
                      <Box>
                        <Heading level={3}>Visibility</Heading>
                        <Text semantic="p">Choose where this accessory appears.</Text>
                      </Box>
                    </Box>
                    <Box className="haus-visibility-row">
                      <Text>
                        {hiddenFromHome ? <Eye size={16} /> : <EyeOff size={16} />}
                        <Text>
                          <Text semantic="strong">Home view</Text>
                          <Text semantic="small">
                            {hiddenFromHome ? 'Hidden on Home' : 'Shown on Home'}
                          </Text>
                        </Text>
                      </Text>
                      <Button variant="secondary" onPress={onToggleHomeVisibility}>
                        {hiddenFromHome ? 'Show on Home' : 'Hide from Home view'}
                      </Button>
                    </Box>
                    <Box className="haus-visibility-row">
                      <Text>
                        {hiddenFromApp ? <Eye size={16} /> : <EyeOff size={16} />}
                        <Text>
                          <Text semantic="strong">Haus app</Text>
                          <Text semantic="small">
                            {hiddenFromApp ? 'In Hidden' : 'Shown throughout the app'}
                          </Text>
                        </Text>
                      </Text>
                      <Button variant="secondary" onPress={onToggleAppVisibility}>
                        {hiddenFromApp ? 'Restore to app' : 'Hide from app'}
                      </Button>
                    </Box>
                  </Box>
                  <HausForm
                    onSubmit={() => {
                      const trimmed = name.trim();
                      if (trimmed)
                        void request(
                          () => onRename(trimmed),
                          demo ? 'Name changed in the sample home.' : 'Accessory name saved.',
                        );
                    }}
                  >
                    <Text semantic="label" className="haus-field">
                      Accessory name
                      <TextInput
                        value={name}
                        maxLength={120}
                        required
                        disabled={pending || !snapshot.user.is_admin}
                        onChange={setName}
                      />
                    </Text>
                    <Button
                      type="submit"
                      variant="secondary"
                      isDisabled={
                        pending ||
                        !snapshot.user.is_admin ||
                        !name.trim() ||
                        name === accessory.name
                      }
                    >
                      Save name
                    </Button>
                  </HausForm>
                  <HausForm
                    onSubmit={() => {
                      void request(
                        () => onMove(room),
                        demo ? 'Room changed in the sample home.' : 'Room saved.',
                      );
                    }}
                  >
                    <Text semantic="label" className="haus-field">
                      Room
                      <SelectInput
                        value={room}
                        disabled={pending || !snapshot.user.is_admin}
                        options={[
                          { value: '', label: 'Unassigned' },
                          ...snapshot.areas.map((item) => ({
                            value: item.area_id,
                            label: item.name,
                          })),
                        ]}
                        onChange={setRoom}
                      />
                    </Text>
                    <Button
                      type="submit"
                      variant="secondary"
                      isDisabled={
                        pending || !snapshot.user.is_admin || room === (accessory.areaId ?? '')
                      }
                    >
                      Move to room
                    </Button>
                  </HausForm>
                  <Text semantic="p" className="haus-settings-note">
                    {demo
                      ? 'Room and name changes stay in this sample home.'
                      : 'Room and name changes sync across your home.'}
                    {!snapshot.user.is_admin &&
                      ' An administrator account is required to edit them.'}
                  </Text>
                </Tabs.Panel>
              </Tabs>
              <Box className="haus-command-feedback" ariaLive="polite">
                {slowPending ? (
                  <Text semantic="p" className="haus-command-pending">
                    <Text />
                    Updating…
                  </Text>
                ) : error ? (
                  <Text semantic="p" className="haus-inline-error" role="alert">
                    {error}
                  </Text>
                ) : !pending && !syncing && notice ? (
                  <Text semantic="p">{notice}</Text>
                ) : null}
              </Box>
            </ScrollShadow>
          </Modal.Body>
          <Modal.Footer className="haus-controller-footer">
            <Text className="haus-footer-dot" />
            {demo && <Text>SAMPLE HOME</Text>}
            <Text className="haus-footer-live">
              {slowPending
                ? 'Updating…'
                : unavailable
                  ? 'Unavailable'
                  : demo
                    ? 'Local preview'
                    : 'Live connection'}
            </Text>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
