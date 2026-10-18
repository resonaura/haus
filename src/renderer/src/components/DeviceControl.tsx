import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import {
  Button,
  ColorArea,
  ColorSlider,
  Label,
  Modal,
  ScrollShadow,
  Slider,
  Switch,
  Tabs,
  parseColor,
  type Color,
} from '@heroui/react';
import {
  buildAction,
  isSegmentEntity,
  resolveCapabilities,
  type HausAccessory,
  type Snapshot,
} from '../model';
import './controls.css';
import { lightColor } from '../model/light-color';
import { lightStateDescription, lightTemperature } from '../model/light-profile';
import { deviceAppearance } from '../model/device-appearance';
import { useDelayedPending } from '../hooks/useDelayedPending';

type Entity = HausAccessory['state'];
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
const colorFromLight = (entity: Entity): Color => parseColor(lightColor(entity) ?? '#f3cf74');

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

function Glyph({ name, className = '' }: { name: string; className?: string }) {
  const paths: Record<string, ReactNode> = {
    light: (
      <>
        <path d="M9 18h6m-5 3h4M8.1 13.7a6 6 0 1 1 7.8 0c-1 .9-1.9 1.6-1.9 3.3h-4c0-1.7-.9-2.4-1.9-3.3Z" />
        <path d="M12 1v1M3.5 4.5l1 1m15-1-1 1M1 12h1m20 0h1" />
      </>
    ),
    power: (
      <>
        <path d="M12 2v9" />
        <path d="M6 5.5a9 9 0 1 0 12 0" />
      </>
    ),
    lock: (
      <>
        <rect x="5" y="10" width="14" height="11" rx="3" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2" />
      </>
    ),
    media: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <path d="m10 8 6 4-6 4Z" />
      </>
    ),
    cover: (
      <>
        <path d="M4 3h16v18H4zM4 7h16M4 11h16M4 15h16M12 18v3" />
      </>
    ),
    climate: (
      <>
        <path d="M10 14.5V5a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0Z" />
        <path d="M12 9v8m6-11h3m-3 5h3" />
      </>
    ),
    fan: (
      <>
        <circle cx="12" cy="12" r="2" />
        <path d="M10 10C5 5 10 1 13 3c2 1 0 5-1 7m2 1c7-1 8 5 5 7-2 1-4-2-6-4m-2 0c-2 6-8 5-8 1 0-3 4-3 7-3" />
      </>
    ),
    sensor: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="m12 12 4-4M7 16h10" />
        <circle cx="12" cy="12" r="1" />
      </>
    ),
    star: <path d="m12 2 3 6.1 6.7 1-4.8 4.7 1.1 6.6-6-3.1-6 3.1 1.1-6.6-4.8-4.7 6.7-1Z" />,
    chevron: <path d="m9 5 7 7-7 7" />,
    previous: (
      <>
        <path d="m17 5-9 7 9 7Z" />
        <path d="M5 5v14" />
      </>
    ),
    next: (
      <>
        <path d="m7 5 9 7-9 7Z" />
        <path d="M19 5v14" />
      </>
    ),
    play: <path d="m7 4 13 8-13 8Z" />,
    pause: (
      <>
        <path d="M8 5v14M16 5v14" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    minus: <path d="M5 12h14" />,
    plus: <path d="M5 12h14M12 5v14" />,
  };
  return (
    <svg
      className={className}
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.sensor}
    </svg>
  );
}

const numeric = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const strings = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
const humanize = (value: string) =>
  value.replaceAll('_', ' ').replace(/^./, (char) => char.toUpperCase());
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Sends one command at the end of a drag; arrow keys and a focused mouse wheel work too. */
export function ControlRange({
  label,
  value,
  min = 0,
  max = 100,
  step = 1,
  unit = '%',
  disabled,
  vertical = false,
  onCommit,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  disabled: boolean;
  vertical?: boolean;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(value);
  const wrapper = useRef<HTMLDivElement>(null);
  const draftRef = useRef(value);
  const editing = useRef(false);
  const commitRef = useRef(onCommit);
  useEffect(() => {
    if (editing.current) return;
    setDraft(value);
    draftRef.current = value;
  }, [value]);
  useEffect(() => {
    commitRef.current = onCommit;
  }, [onCommit]);
  useEffect(() => {
    const element = wrapper.current;
    if (!element) return;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const onWheel = (event: WheelEvent) => {
      if (disabled || !element.contains(document.activeElement)) return;
      event.preventDefault();
      const next =
        Math.round(clamp(draftRef.current + (event.deltaY < 0 ? step : -step), min, max) * 1000) /
        1000;
      draftRef.current = next;
      editing.current = true;
      setDraft(next);
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        editing.current = false;
        commitRef.current(next);
      }, 180);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      element.removeEventListener('wheel', onWheel);
      clearTimeout(timeout);
    };
  }, [disabled, min, max, step]);
  return (
    <div
      ref={wrapper}
      className={vertical ? 'haus-range-wrap haus-range-wrap--vertical' : 'haus-range-wrap'}
    >
      <Slider
        className={vertical ? 'haus-brightness' : 'haus-control-range'}
        value={draft}
        minValue={min}
        maxValue={max}
        step={step}
        orientation={vertical ? 'vertical' : 'horizontal'}
        isDisabled={disabled}
        aria-label={label}
        onChange={(next) => {
          if (typeof next === 'number') {
            editing.current = true;
            setDraft(next);
            draftRef.current = next;
          }
        }}
        onChangeEnd={(next) => {
          editing.current = false;
          if (typeof next === 'number') onCommit(next);
        }}
      >
        <div className="haus-range-label">
          <Label>{label}</Label>
          <output>
            {draft}
            {unit}
          </output>
        </div>
        <Slider.Track>
          <Slider.Fill />
          <Slider.Thumb />
        </Slider.Track>
      </Slider>
      {vertical && <Glyph name="light" className="haus-brightness-icon" />}
    </div>
  );
}

export function LightColour({
  entity,
  capabilities,
  disabled,
  act,
}: {
  entity: Entity;
  capabilities: string[];
  disabled: boolean;
  act: (intent: Intent, value?: Value) => void;
}) {
  const [color, setColor] = useState(() => colorFromLight(entity));
  const [expanded, setExpanded] = useState(false);
  const reportedColor = lightColor(entity) ?? '#f3cf74';
  useEffect(() => setColor(parseColor(reportedColor)), [reportedColor]);
  const sendColor = (next: Color) => {
    const converted = next.toFormat('rgb');
    act(
      'color',
      ['red', 'green', 'blue'].map((channel) =>
        Math.round(converted.getChannelValue(channel as 'red' | 'green' | 'blue')),
      ),
    );
  };
  const canColor = capabilities.includes('color');
  const canTemperature = capabilities.includes('temperature');
  if (!canColor && !canTemperature) return null;
  const temperatureControl = (
    <ControlRange
      label="White temperature"
      value={lightTemperature(entity) ?? 3000}
      min={numeric(entity.attributes.min_color_temp_kelvin, 2000)}
      max={numeric(entity.attributes.max_color_temp_kelvin, 6500)}
      step={50}
      unit=" K"
      disabled={disabled}
      onCommit={(next) => act('temperature', next)}
    />
  );
  if (!canColor) return <section className="haus-light-colour">{temperatureControl}</section>;
  return (
    <section className="haus-light-colour">
      {canColor && (
        <div className="haus-swatches" aria-label="Light colour presets">
          {[
            ['Candlelight', '#ffc47c'],
            ['Warm white', '#ffe7ba'],
            ['Daylight', '#ecf5ff'],
            ['Rose', '#eea5a9'],
            ['Lavender', '#acaff4'],
            ['Ocean', '#8fc8dc'],
          ].map(([name, hex]) => (
            <Button
              key={hex}
              isIconOnly
              className="haus-swatch"
              aria-label={name}
              isDisabled={disabled}
              style={{ backgroundColor: hex }}
              onPress={() => {
                const next = parseColor(hex);
                setColor(next);
                sendColor(next);
              }}
            />
          ))}
        </div>
      )}
      <Button
        className="haus-colour-expand"
        variant="ghost"
        aria-expanded={expanded}
        onPress={() => setExpanded(!expanded)}
      >
        {canTemperature ? 'Colour & white temperature' : 'Colour'}{' '}
        <Glyph name="chevron" className={expanded ? 'is-expanded' : ''} />
      </Button>
      {expanded && (
        <Tabs defaultSelectedKey={canColor ? 'colour' : 'temperature'} className="haus-colour-tabs">
          <Tabs.ListContainer>
            <Tabs.List aria-label="Light appearance">
              {canColor && (
                <Tabs.Tab id="colour">
                  Colour
                  <Tabs.Indicator />
                </Tabs.Tab>
              )}
              {canTemperature && (
                <Tabs.Tab id="temperature">
                  Temperature
                  <Tabs.Indicator />
                </Tabs.Tab>
              )}
            </Tabs.List>
          </Tabs.ListContainer>
          {canColor && (
            <Tabs.Panel id="colour">
              <ColorArea
                className="haus-colour-area"
                aria-label="Light saturation and brightness"
                colorSpace="hsb"
                xChannel="saturation"
                yChannel="brightness"
                value={color}
                onChange={setColor}
                onChangeEnd={sendColor}
                isDisabled={disabled}
              >
                <ColorArea.Thumb />
              </ColorArea>
              <ColorSlider
                className="haus-hue"
                aria-label="Light hue"
                channel="hue"
                colorSpace="hsb"
                value={color}
                onChange={setColor}
                onChangeEnd={sendColor}
                isDisabled={disabled}
              >
                <ColorSlider.Track>
                  <ColorSlider.Thumb />
                </ColorSlider.Track>
              </ColorSlider>
            </Tabs.Panel>
          )}
          {canTemperature && <Tabs.Panel id="temperature">{temperatureControl}</Tabs.Panel>}
        </Tabs>
      )}
    </section>
  );
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
  const capabilities = resolveCapabilities(entity, snapshot.services);
  const has = (capability: string) => capabilities.includes(capability);
  const isStatelessAction = ['scene', 'button', 'input_button'].includes(domain);
  const unavailable =
    entity.state === 'unavailable' || (entity.state === 'unknown' && !isStatelessAction);
  const active = !['off', 'closed', 'locked', 'idle', 'unavailable', 'unknown'].includes(
    entity.state,
  );
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [name, setName] = useState(accessory.name);
  const [room, setRoom] = useState(accessory.areaId ?? '');
  const [confirmation, setConfirmation] = useState<'lock' | 'unlock' | null>(null);
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
  const displayName =
    area && accessory.name.toLowerCase().startsWith(area.name.toLowerCase() + ' ')
      ? accessory.name.slice(area.name.length + 1)
      : accessory.name;
  const availableServices = Object.keys(snapshot.services[domain] ?? {}).sort();
  const icon =
    domain === 'media_player'
      ? 'media'
      : ['switch', 'input_boolean'].includes(domain)
        ? 'power'
        : domain;
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
  const temperatureUnit = snapshot.config.unit_system?.temperature ?? '°C';
  const targetTemperature = numeric(attrs.temperature, numeric(attrs.current_temperature, 20));
  const tempStep = numeric(attrs.target_temp_step, 0.5);
  const minTemp = numeric(attrs.min_temp, 7);
  const maxTemp = numeric(attrs.max_temp, 35);
  const rangedClimate = entity.state === 'heat_cool';
  const lowTarget = numeric(attrs.target_temp_low, minTemp);
  const highTarget = numeric(attrs.target_temp_high, maxTemp);

  let primary: ReactNode;
  if (domain === 'light' || ['switch', 'input_boolean'].includes(domain)) {
    primary = (
      <div
        className="haus-light-controller"
        style={
          { '--device-color': appearance.accent, '--accent': appearance.accent } as CSSProperties
        }
      >
        {has('brightness') ? (
          <ControlRange
            label="Brightness"
            value={entity.state === 'off' ? 0 : Math.round(numeric(attrs.brightness, 0) / 2.55)}
            disabled={disabled}
            vertical
            onCommit={(next) => act('brightness', next)}
          />
        ) : (
          <Button
            className={`haus-power-surface ${active ? 'is-on' : ''}`}
            isDisabled={disabled || !has('toggle')}
            aria-label={`${active ? 'Turn off' : 'Turn on'} ${accessory.name}`}
            aria-pressed={active}
            onPress={() => act('toggle')}
          >
            <span className="haus-power-fill" />
            <Glyph name={icon} />
            <span>{active ? 'On' : 'Off'}</span>
          </Button>
        )}
        {has('brightness') && has('toggle') && (
          <Switch
            className="haus-color-switch haus-light-power"
            isSelected={active}
            aria-label={`${active ? 'Turn off' : 'Turn on'} ${accessory.name}`}
            isDisabled={disabled}
            onChange={() => act('toggle')}
          >
            <Switch.Content>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
              {active ? 'On' : 'Off'}
            </Switch.Content>
          </Switch>
        )}
        {domain === 'light' && (
          <LightColour entity={entity} capabilities={capabilities} disabled={disabled} act={act} />
        )}
        <p className="haus-control-hint">
          {has('brightness')
            ? 'Drag to adjust · Arrow keys · Scroll when focused'
            : 'Press to change power'}
        </p>
      </div>
    );
  } else if (domain === 'climate') {
    primary = (
      <div className="haus-climate-controller">
        <div className={`haus-thermostat ${entity.state !== 'off' ? 'is-on' : ''}`}>
          <span>Set to</span>
          <strong className={rangedClimate ? 'is-range' : ''}>
            {rangedClimate ? `${lowTarget}–${highTarget}` : targetTemperature}
            <small>{temperatureUnit}</small>
          </strong>
          <span>
            Currently {numeric(attrs.current_temperature, 20)}
            {temperatureUnit}
          </span>
        </div>
        {has('climate-temperature') && rangedClimate && (
          <>
            <ControlRange
              label="Heat below"
              value={lowTarget}
              min={minTemp}
              max={highTarget}
              step={tempStep}
              unit={temperatureUnit}
              disabled={disabled}
              onCommit={(next) =>
                act('climate-temperature', { target_temp_low: next, target_temp_high: highTarget })
              }
            />
            <ControlRange
              label="Cool above"
              value={highTarget}
              min={lowTarget}
              max={maxTemp}
              step={tempStep}
              unit={temperatureUnit}
              disabled={disabled}
              onCommit={(next) =>
                act('climate-temperature', { target_temp_low: lowTarget, target_temp_high: next })
              }
            />
          </>
        )}
        {has('climate-temperature') && !rangedClimate && (
          <>
            <div className="haus-temperature-buttons">
              <Button
                isIconOnly
                aria-label="Decrease target temperature"
                isDisabled={disabled || targetTemperature <= minTemp}
                onPress={() =>
                  act('climate-temperature', clamp(targetTemperature - tempStep, minTemp, maxTemp))
                }
              >
                <Glyph name="minus" />
              </Button>
              <span>Target temperature</span>
              <Button
                isIconOnly
                aria-label="Increase target temperature"
                isDisabled={disabled || targetTemperature >= maxTemp}
                onPress={() =>
                  act('climate-temperature', clamp(targetTemperature + tempStep, minTemp, maxTemp))
                }
              >
                <Glyph name="plus" />
              </Button>
            </div>
            <ControlRange
              label="Temperature"
              value={targetTemperature}
              min={minTemp}
              max={maxTemp}
              step={tempStep}
              unit={temperatureUnit}
              disabled={disabled}
              onCommit={(next) => act('climate-temperature', next)}
            />
          </>
        )}
        {has('hvac-mode') && (
          <label className="haus-field">
            Mode
            <select
              value={entity.state}
              disabled={disabled}
              onChange={(event) => act('hvac-mode', event.target.value)}
            >
              {strings(attrs.hvac_modes).map((mode) => (
                <option key={mode} value={mode}>
                  {humanize(mode)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    );
  } else if (domain === 'cover') {
    primary = (
      <div className="haus-cover-controller">
        <div className="haus-cover-illustration" aria-hidden="true">
          <div
            style={{
              height: `${100 - numeric(attrs.current_position, entity.state === 'closed' ? 0 : 100)}%`,
            }}
          />
          <span />
        </div>
        <div className="haus-action-row">
          {(['open', 'stop', 'close'] as const).filter(has).map((intent) => (
            <Button
              key={intent}
              className="haus-secondary-action"
              variant="secondary"
              isDisabled={disabled}
              onPress={() => act(intent)}
            >
              {humanize(intent)}
            </Button>
          ))}
        </div>
        {has('position') && (
          <ControlRange
            label="Open position"
            value={numeric(attrs.current_position, 0)}
            disabled={disabled}
            onCommit={(next) => act('position', next)}
          />
        )}
      </div>
    );
  } else if (domain === 'media_player') {
    primary = (
      <div className="haus-media-controller">
        <div className="haus-media-art">
          <Glyph name="media" />
          <span>{typeof attrs.app_name === 'string' ? attrs.app_name : 'Now playing'}</span>
        </div>
        <h3>{typeof attrs.media_title === 'string' ? attrs.media_title : accessory.name}</h3>
        <p>
          {typeof attrs.media_artist === 'string' ? attrs.media_artist : humanize(entity.state)}
        </p>
        <div className="haus-transport">
          {availableServices.includes('media_previous_track') && (
            <Button
              isIconOnly
              variant="ghost"
              aria-label="Previous track"
              isDisabled={disabled}
              onPress={() => explicitService('media_previous_track')}
            >
              <Glyph name="previous" />
            </Button>
          )}
          {has('play-pause') && (
            <Button
              className="haus-play-button"
              isIconOnly
              aria-label={entity.state === 'playing' ? 'Pause' : 'Play'}
              isDisabled={disabled}
              onPress={() => act('play-pause')}
            >
              <Glyph name={entity.state === 'playing' ? 'pause' : 'play'} />
            </Button>
          )}
          {availableServices.includes('media_next_track') && (
            <Button
              isIconOnly
              variant="ghost"
              aria-label="Next track"
              isDisabled={disabled}
              onPress={() => explicitService('media_next_track')}
            >
              <Glyph name="next" />
            </Button>
          )}
        </div>
        {has('volume') && (
          <ControlRange
            label="Volume"
            value={Math.round(numeric(attrs.volume_level, 0) * 100)}
            disabled={disabled}
            onCommit={(next) => act('volume', next / 100)}
          />
        )}
        {has('toggle') && (
          <Button variant="secondary" isDisabled={disabled} onPress={() => act('toggle')}>
            <Glyph name="power" />
            Power
          </Button>
        )}
      </div>
    );
  } else if (domain === 'fan') {
    primary = (
      <div className="haus-fan-controller">
        <div className={`haus-fan-orb ${active ? 'is-on' : ''}`}>
          <Glyph name="fan" />
        </div>
        {has('toggle') && (
          <Button
            className="haus-primary-action"
            isDisabled={disabled}
            onPress={() => act('toggle')}
          >
            Turn {active ? 'off' : 'on'}
          </Button>
        )}
        {has('percentage') && (
          <ControlRange
            label="Fan speed"
            value={numeric(attrs.percentage, 0)}
            step={numeric(attrs.percentage_step, 1)}
            disabled={disabled}
            onCommit={(next) => act('percentage', next)}
          />
        )}
      </div>
    );
  } else if (domain === 'lock') {
    const intent = entity.state === 'locked' ? 'unlock' : 'lock';
    primary = (
      <div className="haus-lock-controller">
        <div className={`haus-lock-orb ${entity.state === 'locked' ? 'is-locked' : ''}`}>
          <Glyph name="lock" />
        </div>
        <p>
          {['locking', 'unlocking'].includes(entity.state)
            ? 'Updating lock…'
            : entity.state === 'locked'
              ? 'Your door is secured.'
              : 'Your door is not locked.'}
        </p>
        {confirmation ? (
          <div className="haus-lock-confirm">
            <p>
              Confirm {confirmation} for {accessory.name}?
            </p>
            <div className="haus-action-row">
              <Button variant="secondary" onPress={() => setConfirmation(null)}>
                Cancel
              </Button>
              <Button
                className="haus-primary-action"
                isDisabled={disabled}
                onPress={() => {
                  act(confirmation);
                  setConfirmation(null);
                }}
              >
                Confirm {confirmation}
              </Button>
            </div>
          </div>
        ) : (
          has(intent) && (
            <Button
              className="haus-primary-action"
              isDisabled={disabled}
              onPress={() => setConfirmation(intent)}
            >
              {humanize(intent)} door
            </Button>
          )
        )}
      </div>
    );
  } else if (has('run') || has('press')) {
    primary = (
      <div className="haus-scene-controller">
        <div className="haus-fan-orb">
          <Glyph name="star" />
        </div>
        <p>
          {domain === 'scene'
            ? 'Set the atmosphere with one action.'
            : 'Run this Home Assistant action.'}
        </p>
        <Button
          className="haus-primary-action"
          isDisabled={disabled}
          onPress={() => act(has('run') ? 'run' : 'press')}
        >
          {domain === 'scene' ? 'Activate scene' : 'Run action'}
        </Button>
      </div>
    );
  } else if (has('select')) {
    primary = (
      <label className="haus-field">
        Selection
        <select
          value={entity.state}
          disabled={disabled}
          onChange={(event) => act('select', event.target.value)}
        >
          {strings(attrs.options).map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      </label>
    );
  } else if (has('value')) {
    primary = (
      <ControlRange
        label="Value"
        value={Number(entity.state) || 0}
        min={numeric(attrs.min, 0)}
        max={numeric(attrs.max, 100)}
        step={numeric(attrs.step, 1)}
        unit={typeof attrs.unit_of_measurement === 'string' ? ` ${attrs.unit_of_measurement}` : ''}
        disabled={disabled}
        onCommit={(next) => act('value', next)}
      />
    );
  } else {
    primary = (
      <div className="haus-sensor-controller">
        <div className="haus-sensor-glyph">
          <Glyph name={icon} />
        </div>
        <strong>
          {humanize(entity.state)}
          <small>
            {typeof attrs.unit_of_measurement === 'string' ? attrs.unit_of_measurement : ''}
          </small>
        </strong>
        <p>Live device state</p>
        <div className="haus-sensor-metrics">
          {Object.entries(attrs)
            .filter(
              ([key, value]) =>
                !['friendly_name', 'icon', 'supported_features', 'unit_of_measurement'].includes(
                  key,
                ) && ['string', 'number', 'boolean'].includes(typeof value),
            )
            .slice(0, 6)
            .map(([key, value]) => (
              <div key={key}>
                <span>{humanize(key)}</span>
                <b>{String(value)}</b>
              </div>
            ))}
        </div>
      </div>
    );
  }

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
          className={`haus-device-modal is-${theme}`}
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
              <Glyph name={icon} />
            </span>
            <span className="haus-controller-room">
              {area?.name ?? 'My Home'} <span> / </span>
              {humanize(domain)}
            </span>
            <Modal.Heading>{displayName}</Modal.Heading>
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
                  {controlEntities.length > 1 && (
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
                  <div className="haus-primary-content">{primary}</div>
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
                        <dd>{humanize(entity.state)}</dd>
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

function SecondaryEntity({
  entity,
  disabled,
  onAction,
}: {
  entity: Entity;
  disabled: boolean;
  onAction: (action: Action) => void;
}) {
  const domain = entity.entity_id.split('.')[0];
  const attrs = entity.attributes;
  const [draft, setDraft] = useState(entity.state);
  const [localError, setLocalError] = useState('');
  const act = (intent: Intent, value?: Value) => {
    try {
      setLocalError('');
      onAction(buildAction(entity, intent, value));
    } catch (reason) {
      setLocalError(reason instanceof Error ? reason.message : 'This action is unavailable.');
    }
  };
  return (
    <div className="haus-secondary-entity">
      <div>
        <span>
          {typeof attrs.friendly_name === 'string'
            ? attrs.friendly_name
            : humanize(entity.entity_id.split('.')[1])}
        </span>
        <small>{entity.entity_id}</small>
      </div>
      {['switch', 'input_boolean'].includes(domain) ? (
        <Button
          size="sm"
          variant="secondary"
          isDisabled={disabled}
          aria-label={`Toggle ${typeof attrs.friendly_name === 'string' ? attrs.friendly_name : entity.entity_id}`}
          aria-pressed={entity.state === 'on'}
          onPress={() => act('toggle')}
        >
          {humanize(entity.state)}
        </Button>
      ) : ['button', 'input_button'].includes(domain) ? (
        <Button size="sm" variant="secondary" isDisabled={disabled} onPress={() => act('press')}>
          Run
        </Button>
      ) : ['select', 'input_select'].includes(domain) ? (
        <select
          aria-label={
            typeof attrs.friendly_name === 'string' ? attrs.friendly_name : entity.entity_id
          }
          disabled={disabled}
          value={entity.state}
          onChange={(event) => act('select', event.target.value)}
        >
          {strings(attrs.options).map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      ) : ['number', 'input_number'].includes(domain) ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const next = Number(draft);
            if (Number.isFinite(next)) act('value', next);
          }}
        >
          <input
            type="number"
            aria-label={
              typeof attrs.friendly_name === 'string' ? attrs.friendly_name : entity.entity_id
            }
            value={draft}
            min={numeric(attrs.min, 0)}
            max={numeric(attrs.max, 100)}
            step={numeric(attrs.step, 1)}
            disabled={disabled}
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button type="submit" size="sm" variant="secondary" isDisabled={disabled}>
            Set
          </Button>
        </form>
      ) : (
        <b>
          {humanize(entity.state)}{' '}
          {typeof attrs.unit_of_measurement === 'string' ? attrs.unit_of_measurement : ''}
        </b>
      )}
      {localError && (
        <p role="alert" className="haus-inline-error">
          {localError}
        </p>
      )}
    </div>
  );
}
