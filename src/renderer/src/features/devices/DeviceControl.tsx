import { NetworkDetails } from './NetworkDetails';
import { MediaRemote } from './MediaRemote';
import { ButtonController } from './ButtonController';
import { PowerStripControls } from './PowerStripControls';
import { PrinterSupplies } from './PrinterSupplies';
import { DeviceHistory } from '../statistics/DeviceHistory';
import { PrimaryControls } from './controls/PrimaryControls';
import { Glyph } from './controls/ControlGlyph';

import { SecondaryEntity } from './SecondaryEntity';
import { humanize } from './controls/control-values';
import { AccessoryIcon } from '../../components/icons/Icon';
import { deviceDisplayName, deviceSource } from '../../model/device-name';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Button, Modal, ScrollShadow, Tabs } from '@heroui/react';
import { buildAction, isSegmentEntity, type HausAccessory, type Snapshot } from '../../model';

import { lightStateDescription } from '../../model/light-profile';
import { binaryStateDescription, deviceAppearance } from '../../model/device-appearance';
import { useDelayedPending } from '../../hooks/useDelayedPending';

type Action = ReturnType<typeof buildAction>;
type Intent = Parameters<typeof buildAction>[1];
type Value = Parameters<typeof buildAction>[2];
const deviceControlDomains = new Set([
  'light',
  'switch',
  'climate',
  'cover',
  'media_player',
  'lock',
  'fan',
  'valve',
  'humidifier',
  'water_heater',
  'alarm_control_panel',
  'vacuum',
  'siren',
  'select',
  'number',
  'button',
  'input_boolean',
  'input_number',
  'input_select',
  'input_button',
]);

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
  const controlEntities = useMemo(() => {
    const registry = new Map(snapshot.entities.map((entry) => [entry.entity_id, entry]));
    const related = accessory.secondaryEntities.filter((item) => {
      const entry = registry.get(item.entity_id);
      return (
        deviceControlDomains.has(item.entity_id.split('.')[0]) &&
        !entry?.disabled_by &&
        !entry?.hidden_by &&
        !entry?.entity_category &&
        !isSegmentEntity(item)
      );
    });
    const controls = [accessory.state, ...related];
    const nonCameraControls = controls.filter((item) => item.entity_id.split('.')[0] !== 'camera');
    return nonCameraControls.length ? nonCameraControls : controls;
  }, [accessory, snapshot.entities]);
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
  const deviceKind = accessory.physicalHub
    ? 'Hub'
    : accessory.buttonController
      ? 'Wireless remote'
      : accessory.powerStrip
        ? 'Power strip'
        : accessory.category === 'network'
          ? 'Network'
          : humanize(domain);
  const displayName = deviceDisplayName(accessory.name, area?.name, humanize(domain));
  const availableServices = Object.keys(snapshot.services[domain] ?? {}).sort();
  const request = async (
    operation: () => Promise<void>,
    success = demo ? 'Updated in the sample home. Changes stay in this preview.' : 'Changes sent.',
    allowConcurrent = false,
  ) => {
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
          className={`haus-device-modal is-${theme} ${domain === 'media_player' || accessory.powerStrip || accessory.buttonController ? 'is-wide' : ''}`}
          data-active={appearance.active || undefined}
          data-pending={slowPending || undefined}
          style={{ '--device-color': appearance.accent } as CSSProperties}
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
            <span className="haus-controller-glyph" aria-hidden="true">
              <AccessoryIcon
                accessory={{ ...accessory, state: entity, primaryEntityId: entity.entity_id }}
                size={27}
              />
            </span>
            <span className="haus-controller-room">
              {area?.name ?? 'My Home'} <span> / </span>
              {deviceKind}
            </span>
            <Modal.Heading>
              {displayName}
              {deviceSource(accessory.name) && (
                <span className="scene-source-badge scene-source-inline device-source-badge">
                  Hue
                </span>
              )}
            </Modal.Heading>
            <p
              className={`haus-controller-status ${unavailable ? 'is-unavailable' : ''}`}
              aria-live="polite"
            >
              <span />
              {unavailable
                ? 'No response'
                : isStatelessAction && entity.state === 'unknown'
                  ? 'Ready'
                  : domain === 'light'
                    ? lightStateDescription(entity)
                    : humanize(entity.state)}
              {slowPending && ' · Updating…'}
            </p>
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
                      <section className="haus-entity-picker" aria-label="Controls for this device">
                        <div className="haus-entity-picker-heading">
                          <h3>Controls on this device</h3>
                          <span>{controlEntities.length}</span>
                        </div>
                        <ScrollShadow
                          className="haus-entity-picker-scroll"
                          orientation="horizontal"
                          hideScrollBar
                          size={20}
                        >
                          <div className="haus-entity-picker-list">
                            {controlEntities.map((item) => (
                              <Button
                                key={item.entity_id}
                                className={`haus-entity-option ${item.entity_id === entity.entity_id ? 'is-selected' : ''}`}
                                variant="ghost"
                                aria-pressed={item.entity_id === entity.entity_id}
                                onPress={() => setSelectedEntityId(item.entity_id)}
                              >
                                <span>
                                  {String(
                                    item.attributes.friendly_name ??
                                      humanize(item.entity_id.split('.')[1]),
                                  )}
                                </span>
                                <small>{humanize(item.entity_id.split('.')[0])}</small>
                              </Button>
                            ))}
                          </div>
                        </ScrollShadow>
                      </section>
                    )}
                  {unavailable && (
                    <p className="haus-inline-warning">
                      This accessory is unavailable. Controls return when Home Assistant reports it
                      online.
                    </p>
                  )}
                  {accessory.category === 'printers' && (
                    <PrinterSupplies accessory={accessory} demo={demo} />
                  )}
                  {accessory.category === 'network' ? (
                    <NetworkDetails accessory={accessory} />
                  ) : accessory.buttonController ? (
                    <ButtonController accessory={accessory} snapshot={snapshot} demo={demo} />
                  ) : accessory.powerStrip ? (
                    <PowerStripControls
                      entities={controlEntities}
                      name={accessory.name}
                      onAction={(action) => void request(() => onAction(action), undefined, true)}
                    />
                  ) : (
                    <div className="haus-primary-content">
                      <PrimaryControls
                        key={entity.entity_id}
                        accessory={accessory}
                        entity={entity}
                        snapshot={snapshot}
                        disabled={disabled}
                        act={act}
                        explicitService={explicitService}
                      />
                      {domain === 'media_player' &&
                        /apple\s*tv|tvos/i.test(`${accessory.model ?? ''} ${accessory.name}`) && (
                          <MediaRemote
                            entities={[accessory.state, ...accessory.secondaryEntities]}
                            snapshot={snapshot}
                            onAction={(action) =>
                              void request(() => onAction(action), undefined, true)
                            }
                          />
                        )}
                    </div>
                  )}
                </Tabs.Panel>
                <Tabs.Panel id="history" className="haus-detail-panel">
                  <DeviceHistory accessory={accessory} demo={demo} />
                </Tabs.Panel>
                <Tabs.Panel id="details" className="haus-detail-panel">
                  <section className="haus-entity-detail">
                    <h3>About this accessory</h3>
                    <dl>
                      <div>
                        <dt>Entity</dt>
                        <dd>{entity.entity_id}</dd>
                      </div>
                      <div>
                        <dt>State</dt>
                        <dd>{binaryStateDescription(entity) ?? humanize(entity.state)}</dd>
                      </div>
                      <div>
                        <dt>Updated</dt>
                        <dd>
                          {entity.last_updated
                            ? new Date(entity.last_updated).toLocaleString()
                            : '—'}
                        </dd>
                      </div>
                    </dl>
                  </section>
                  {accessory.secondaryEntities.length > 0 && (
                    <section className="haus-secondary-entities">
                      <h3>Related controls & diagnostics</h3>
                      {accessory.secondaryEntities.map((secondary) => (
                        <SecondaryEntity
                          key={secondary.entity_id}
                          entity={secondary}
                          disabled={
                            pending ||
                            secondary.state === 'unavailable' ||
                            (secondary.state === 'unknown' &&
                              !['button', 'input_button'].includes(
                                secondary.entity_id.split('.')[0],
                              ))
                          }
                          onAction={(action) => {
                            void request(() => onAction(action));
                          }}
                        />
                      ))}
                    </section>
                  )}
                  <details className="haus-advanced">
                    <summary>
                      Available actions <Glyph name="chevron" />
                    </summary>
                    <p>Run an action supported by this Home Assistant domain.</p>
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
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
                      <label className="haus-field">
                        Action
                        <select
                          required
                          value={service}
                          disabled={disabled}
                          onChange={(event) => setService(event.target.value)}
                        >
                          <option value="">Choose an action</option>
                          {availableServices.map((item) => (
                            <option key={item} value={item}>
                              {humanize(item)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="haus-field">
                        Action data (JSON)
                        <textarea
                          value={serviceData}
                          spellCheck={false}
                          onChange={(event) => setServiceData(event.target.value)}
                          disabled={disabled}
                        />
                      </label>
                      <Button
                        type="submit"
                        className="haus-primary-action"
                        isDisabled={disabled || !service}
                      >
                        Run action
                      </Button>
                    </form>
                  </details>
                  <details className="haus-advanced">
                    <summary>
                      All attributes <Glyph name="chevron" />
                    </summary>
                    <ScrollShadow
                      className="haus-attrs-scroll"
                      orientation="vertical"
                      size={20}
                      hideScrollBar
                    >
                      <pre>{JSON.stringify(attrs, null, 2)}</pre>
                    </ScrollShadow>
                  </details>
                </Tabs.Panel>
                <Tabs.Panel id="settings" className="haus-settings-panel">
                  <section className="haus-visibility-settings">
                    <div className="haus-visibility-heading">
                      <div>
                        <h3>Visibility</h3>
                        <p>Choose where this accessory appears.</p>
                      </div>
                    </div>
                    <div className="haus-visibility-row">
                      <span>
                        {hiddenFromHome ? <Eye size={16} /> : <EyeOff size={16} />}
                        <span>
                          <strong>Home view</strong>
                          <small>{hiddenFromHome ? 'Hidden on Home' : 'Shown on Home'}</small>
                        </span>
                      </span>
                      <Button variant="secondary" onPress={onToggleHomeVisibility}>
                        {hiddenFromHome ? 'Show on Home' : 'Hide from Home view'}
                      </Button>
                    </div>
                    <div className="haus-visibility-row">
                      <span>
                        {hiddenFromApp ? <Eye size={16} /> : <EyeOff size={16} />}
                        <span>
                          <strong>Haus app</strong>
                          <small>{hiddenFromApp ? 'In Hidden' : 'Shown throughout the app'}</small>
                        </span>
                      </span>
                      <Button variant="secondary" onPress={onToggleAppVisibility}>
                        {hiddenFromApp ? 'Restore to app' : 'Hide from app'}
                      </Button>
                    </div>
                  </section>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      const trimmed = name.trim();
                      if (trimmed)
                        void request(
                          () => onRename(trimmed),
                          demo
                            ? 'Name changed in the sample home.'
                            : 'Accessory name saved in Home Assistant.',
                        );
                    }}
                  >
                    <label className="haus-field">
                      Accessory name
                      <input
                        value={name}
                        maxLength={120}
                        required
                        disabled={pending || !snapshot.user.is_admin}
                        onChange={(event) => setName(event.target.value)}
                      />
                    </label>
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
                  </form>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void request(
                        () => onMove(room),
                        demo ? 'Room changed in the sample home.' : 'Room saved in Home Assistant.',
                      );
                    }}
                  >
                    <label className="haus-field">
                      Room
                      <select
                        value={room}
                        disabled={pending || !snapshot.user.is_admin}
                        onChange={(event) => setRoom(event.target.value)}
                      >
                        <option value="">Unassigned</option>
                        {snapshot.areas.map((item) => (
                          <option key={item.area_id} value={item.area_id}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <Button
                      type="submit"
                      variant="secondary"
                      isDisabled={
                        pending || !snapshot.user.is_admin || room === (accessory.areaId ?? '')
                      }
                    >
                      Move to room
                    </Button>
                  </form>
                  <p className="haus-settings-note">
                    {demo
                      ? 'Room and name changes stay in this sample home.'
                      : 'Room and name changes sync with Home Assistant.'}
                    {!snapshot.user.is_admin &&
                      ' An administrator account is required to edit them.'}
                  </p>
                </Tabs.Panel>
              </Tabs>
              <div className="haus-command-feedback" aria-live="polite" aria-atomic="true">
                {slowPending ? (
                  <p className="haus-command-pending">
                    <span />
                    Updating…
                  </p>
                ) : error ? (
                  <p className="haus-inline-error" role="alert">
                    {error}
                  </p>
                ) : !pending && !syncing && notice ? (
                  <p>{notice}</p>
                ) : null}
              </div>
            </ScrollShadow>
          </Modal.Body>
          <Modal.Footer className="haus-controller-footer">
            <span className="haus-footer-dot" />
            {demo && <span>SAMPLE HOME</span>}
            <span className="haus-footer-live">
              {slowPending
                ? 'Updating…'
                : unavailable
                  ? 'Unavailable'
                  : demo
                    ? 'Local preview'
                    : 'Live connection'}
            </span>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
