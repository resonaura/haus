/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useState } from 'react';
import { LIGHT_COLOUR_PRESETS } from '@haus/core/transport';
import { colorToken, corners, insets, pct, px, rgba } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import {
  Box,
  Grid,
  HausSegmentedControl,
  Stack,
  Text,
} from '../../primitives/index.js';
import { AutomationTile } from '../automations/automation-tile.js';
import { DeviceTile } from '../devices/device.js';
import {
  ButtonRemoteModalPanel,
  ClimateModalPanel,
  CoverModalPanel,
  LightModalPanel,
  LockModalPanel,
  MediaModalPanel,
  SwitchActionModalPanel,
} from '../devices/modal/index.js';
import { PowerStripPanel } from '../devices/specialty-controls.js';
import { SceneCardCollection } from '../scenes/collection.js';

type ModalPreviewKind =
  | 'light'
  | 'climate'
  | 'cover'
  | 'lock'
  | 'switch'
  | 'strip'
  | 'media'
  | 'remote';

const DEMO_SCENES = [
  {
    entityId: 'scene.bedroom_netflix_and_chill',
    name: 'Netflix And Chill',
    title: 'Netflix And Chill',
    room: 'Bedroom',
    source: 'Hue',
    colors: ['#e50914', '#b81d24', '#ff5a36'],
    count: 4,
  },
  {
    entityId: 'scene.living_arctic_aurora',
    name: 'Arctic Aurora',
    title: 'Arctic Aurora',
    room: 'Living Room',
    source: 'Hue',
    colors: ['#00d2ff', '#2ce69b', '#6b5bff', '#1f8fff'],
    count: 6,
    active: true,
  },
  {
    entityId: 'scene.studio_savanna_sunset',
    name: 'Savanna Sunset',
    title: 'Savanna Sunset',
    room: 'Studio',
    source: 'Hue',
    colors: ['#ff5e3a', '#ff9500', '#ffcc4d', '#e84362'],
    count: 5,
  },
  {
    entityId: 'scene.bedroom_relax',
    name: 'Relax',
    title: 'Relax',
    room: 'Bedroom',
    source: 'Hue',
    colors: ['#ffad5c', '#ffc078'],
    count: 3,
  },
  {
    entityId: 'scene.home_good_night',
    name: 'Good Night',
    title: 'Good Night',
    room: 'Whole home',
    colors: ['#ff8a3d', '#b85d28'],
    dark: true,
    count: 12,
  },
] as const;

export function StoryboardCardsShowcase() {
  const [lampOn, setLampOn] = useState(true);
  const [plugOn, setPlugOn] = useState(true);
  const [ruleOn, setRuleOn] = useState(true);
  const [activeScene, setActiveScene] = useState('scene.living_arctic_aurora');

  const [modalTab, setModalTab] = useState<ModalPreviewKind>('light');
  const [lightBright, setLightBright] = useState(76);
  const [lightRgb, setLightRgb] = useState<[number, number, number]>([255, 179, 71]);
  const [lightKelvin, setLightKelvin] = useState(2700);
  const [climateTemp, setClimateTemp] = useState(21.5);
  const [climateMode, setClimateMode] = useState('heat');
  const [coverPos, setCoverPos] = useState(65);
  const [doorLocked, setDoorLocked] = useState(true);
  const [mediaPlaying, setMediaPlaying] = useState(true);
  const [mediaVol, setMediaVol] = useState(35);
  const [stripState, setStripState] = useState([true, true, false]);

  return (
    <Stack gapPx={20} style={{ layout: { width: pct(100) } }}>
      <Stack gapPx={10} style={{ layout: { width: pct(100) } }}>
        <Text size={15} weight={600}>
          Scenes · Unified Horizontal Rail & Hue Palettes
        </Text>
        <SceneCardCollection
          scrollId="storyboard-scenes-rail"
          horizontal
          showAccessoryCount={false}
          items={DEMO_SCENES.map((s) => ({
            ...s,
            active: activeScene === s.entityId,
            onActivate: () => setActiveScene(s.entityId),
          }))}
        />
      </Stack>

      <Stack gapPx={10} style={{ layout: { width: pct(100) } }}>
        <Text size={15} weight={600}>
          Device & Automation Tiles · GlassRim + Motion-Blurred Wash
        </Text>
        <Grid columns={4} gapPx={12}>
          <DeviceTile
            desktop
            name="Corner Lamp"
            subtitle="Living Room"
            category="lights"
            state={lampOn ? 'On · 76%' : 'Off'}
            available
            active={lampOn}
            accent={rgba(255, 179, 71, 1)}
            colorSwatch={lampOn ? rgba(255, 179, 71, 1) : undefined}
            sourceBadge="Hue"
            onQuick={() => setLampOn((v) => !v)}
            onOpen={() => setModalTab('light')}
          />
          <DeviceTile
            desktop
            name="Desk Espresso"
            subtitle="Kitchen"
            category="other"
            iconName="power"
            state={plugOn ? 'On · 42 W' : 'Off'}
            available
            active={plugOn}
            onQuick={() => setPlugOn((v) => !v)}
            onOpen={() => setModalTab('switch')}
          />
          <DeviceTile
            desktop
            name="Bedroom Thermostat"
            subtitle="Bedroom"
            category="climate"
            state="Heating · 21.5°"
            available
            active
            accent={rgba(251, 146, 60, 1)}
            onOpen={() => setModalTab('climate')}
          />
          <AutomationTile
            item={{
              entityId: 'automation.wall_switch_button_1',
              ruleId: 'wall_switch_1',
              name: 'Bedroom Wall Switch Button 1',
              statusLabel: ruleOn ? 'Active' : 'Paused',
              enabled: ruleOn,
              toggleDisabled: false,
              canEdit: true,
              needsCutover: false,
              cuttingOver: false,
              config: {
                alias: 'Bedroom Wall Switch Button 1',
                triggers: [{ platform: 'event', event_type: 'hue_event' }],
                actions: [{ service: 'scene.turn_on', target: { entity_id: 'scene.bedroom_relax' } }],
              },
            }}
            onEdit={() => setModalTab('remote')}
            onToggle={() => setRuleOn((v) => !v)}
            onRun={() => undefined}
            onCutover={() => undefined}
          />
        </Grid>
      </Stack>

      <Stack gapPx={12} style={{ layout: { width: pct(100) } }}>
        <Text size={15} weight={600}>
          Device Modal Controls · Unified Category Panels
        </Text>
        <HausSegmentedControl<ModalPreviewKind>
          id="storyboard-modal-tabs"
          aria-label="Device modal category preview"
          value={modalTab}
          options={[
            { value: 'light', label: 'Light' },
            { value: 'climate', label: 'Climate' },
            { value: 'cover', label: 'Cover' },
            { value: 'lock', label: 'Lock' },
            { value: 'switch', label: 'Switch' },
            { value: 'strip', label: 'Power Strip' },
            { value: 'media', label: 'Media' },
            { value: 'remote', label: 'Hue Switch' },
          ]}
          onChange={setModalTab}
        />

        <Box
          style={{
            layout: { width: pct(100), maxWidth: px(560), padding: insets(18) },
            material: new SolidMaterial(colorToken('card')),
            border: { width: 1, color: colorToken('border') },
            corners: corners(24),
          }}
        >
          {modalTab === 'light' && (
            <LightModalPanel
              idPrefix="sb-modal-light"
              deviceName="Corner Lamp"
              active={lampOn}
              brightnessPct={lightBright}
              rgb={lightRgb}
              hue={36}
              saturation={72}
              kelvin={lightKelvin}
              canToggle
              canBrightness
              canColor
              canTemperature
              disabled={false}
              presets={LIGHT_COLOUR_PRESETS}
              onToggle={() => setLampOn((v) => !v)}
              onBrightness={(next) => {
                setLightBright(next);
                if (next > 0) setLampOn(true);
              }}
              onColorRgb={setLightRgb}
              onColorHsv={() => undefined}
              onTemperature={setLightKelvin}
            />
          )}
          {modalTab === 'climate' && (
            <ClimateModalPanel
              idPrefix="sb-modal-climate"
              mode={climateMode}
              modes={[
                { value: 'off', label: 'Off' },
                { value: 'heat', label: 'Heat' },
                { value: 'cool', label: 'Cool' },
                { value: 'auto', label: 'Auto' },
              ]}
              currentTempLabel="22.0°C"
              targetTemp={climateTemp}
              unit="°C"
              canSetTemperature
              canSetMode
              disabled={false}
              onTargetTemp={setClimateTemp}
              onModeChange={setClimateMode}
            />
          )}
          {modalTab === 'cover' && (
            <CoverModalPanel
              idPrefix="sb-modal-cover"
              position={coverPos}
              stateLabel={coverPos === 0 ? 'Closed' : 'Open'}
              canPosition
              canOpen
              canStop
              canClose
              disabled={false}
              onPosition={setCoverPos}
              onOpen={() => setCoverPos(100)}
              onStop={() => undefined}
              onClose={() => setCoverPos(0)}
            />
          )}
          {modalTab === 'lock' && (
            <LockModalPanel
              idPrefix="sb-modal-lock"
              deviceName="Front Door"
              locked={doorLocked}
              canToggle
              disabled={false}
              onConfirmAction={(intent) => setDoorLocked(intent === 'lock')}
            />
          )}
          {modalTab === 'switch' && (
            <SwitchActionModalPanel
              idPrefix="sb-modal-switch"
              kind="toggle"
              active={plugOn}
              stateLabel={plugOn ? 'On' : 'Off'}
              metrics={[
                { label: 'Power', value: plugOn ? '42.4 W' : '0.0 W' },
                { label: 'Today', value: '1.38 kWh' },
              ]}
              disabled={false}
              onActivate={() => setPlugOn((v) => !v)}
            />
          )}
          {modalTab === 'strip' && (
            <PowerStripPanel
              outlets={[
                { id: '1', label: 'Monitor', active: stripState[0]!, available: true, isMaster: false },
                { id: '2', label: 'Dock', active: stripState[1]!, available: true, isMaster: false },
                { id: '3', label: 'Lamp', active: stripState[2]!, available: true, isMaster: false },
              ]}
              onToggle={(id) => {
                const idx = Number(id) - 1;
                setStripState((prev) => prev.map((v, i) => (i === idx ? !v : v)));
              }}
            />
          )}
          {modalTab === 'media' && (
            <MediaModalPanel
              idPrefix="sb-modal-media"
              title="Midnight City"
              subtitle="M83 · Hurry Up, We're Dreaming"
              appName="Living Room TV"
              playing={mediaPlaying}
              poweredOn
              volumePct={mediaVol}
              canPrevious
              canPlayPause
              canNext
              canPower
              canVolume
              canRemote
              disabled={false}
              onPrevious={() => undefined}
              onPlayPause={() => setMediaPlaying((v) => !v)}
              onNext={() => undefined}
              onPower={() => undefined}
              onVolume={setMediaVol}
              onRemoteCommand={() => undefined}
            />
          )}
          {modalTab === 'remote' && (
            <ButtonRemoteModalPanel
              buttons={[
                {
                  id: 'b1',
                  label: 'Button 1 · On',
                  lastAction: 'Short release',
                  gestures: ['initial press', 'short release', 'long release'],
                  linkedAutomations: ['Bedroom Bright Scene'],
                },
                {
                  id: 'b2',
                  label: 'Button 2 · Dim Up',
                  lastAction: 'Repeat',
                  gestures: ['initial press', 'repeat', 'short release'],
                },
                {
                  id: 'b3',
                  label: 'Button 3 · Dim Down',
                  gestures: ['initial press', 'repeat', 'short release'],
                },
                {
                  id: 'b4',
                  label: 'Button 4 · Hue',
                  rotary: true,
                  linkedAutomations: ['Netflix And Chill'],
                },
              ]}
            />
          )}
        </Box>
      </Stack>
    </Stack>
  );
}
