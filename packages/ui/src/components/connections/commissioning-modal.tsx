/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useState } from 'react';
import type { DetectedSetupCode } from '@haus/core/transport';
import { colorToken, corners, insets, pct, px, rgba } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import {
  HausButton,
  HausDialog,
  Pressable,
  Row,
  ScrollView,
  Stack,
  Text,
} from '../../primitives/index.js';
import { UiIcon } from '../icon.js';
import {
  CommissioningCodeStep,
  CommissioningCredentialsStep,
} from './commissioning-steps.js';

export type CommissioningStage =
  | 'code_entry'
  | 'candidate_selection'
  | 'credentials'
  | 'pairing'
  | 'complete'
  | 'error';

export interface CommissioningCandidateItem {
  readonly identifier: string;
  readonly name: string;
  readonly protocol: string;
  readonly transport: string;
  readonly address?: string;
  readonly rssi?: number;
}

export interface CommissioningPairedItem {
  readonly id?: string;
  readonly name: string;
  readonly model?: string;
}

export interface CommissioningEventItem {
  readonly seq: number;
  readonly type: string;
  readonly message?: string;
}

export interface CommissioningRoomOption {
  readonly id: string;
  readonly name: string;
}

export interface CommissioningModalProps {
  readonly stage: CommissioningStage;
  readonly rawCode: string;
  readonly detected: DetectedSetupCode;
  readonly demo?: boolean;
  readonly busy?: boolean;
  readonly statusMessage?: string;
  readonly candidates?: readonly CommissioningCandidateItem[];
  readonly events?: readonly CommissioningEventItem[];
  readonly pairedDevices?: readonly CommissioningPairedItem[];
  readonly requiresThread?: boolean;
  readonly rooms?: readonly CommissioningRoomOption[];
  readonly selectedRoomId?: string;
  readonly errorMessage?: string | null;
  readonly actionableHint?: string | null;
  readonly onCodeChange: (code: string) => void;
  readonly onStart: () => void;
  readonly onSelectCandidate: (identifier: string) => void;
  readonly onSubmitCredentials: (input: {
    readonly ssid: string;
    readonly password: string;
    readonly threadDataset?: string;
    readonly saveForReuse: boolean;
  }) => void;
  readonly onSelectRoom: (roomId: string) => void;
  readonly onFinish: () => void;
  readonly onRetry: () => void;
  readonly onCancel: () => void;
}

function stageTitle(stage: CommissioningStage): string {
  if (stage === 'complete') return 'Device ready';
  if (stage === 'error') return 'Setup issue';
  if (stage === 'candidate_selection') return 'Select device';
  if (stage === 'credentials') return 'Network credentials';
  if (stage === 'pairing') return 'Pairing in progress';
  return 'Add device with setup code';
}

function badgeBorder(tone: DetectedSetupCode['badgeTone']) {
  if (tone === 'primary' || tone === 'secondary') return rgba(52, 211, 153, 0.45);
  if (tone === 'warning') return rgba(251, 191, 36, 0.5);
  if (tone === 'danger') return colorToken('critical');
  return colorToken('border');
}

export function CommissioningModal({
  stage,
  rawCode,
  detected,
  demo = false,
  busy = false,
  statusMessage,
  candidates = [],
  events = [],
  pairedDevices = [],
  requiresThread = false,
  rooms = [],
  selectedRoomId = '',
  errorMessage,
  actionableHint,
  onCodeChange,
  onStart,
  onSelectCandidate,
  onSubmitCredentials,
  onSelectRoom,
  onFinish,
  onRetry,
  onCancel,
}: CommissioningModalProps) {
  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [threadDataset, setThreadDataset] = useState('');
  const [saveForReuse, setSaveForReuse] = useState(true);

  const primaryLabel = (text: string) => (
    <Text size={12.5} style={{ typography: { color: colorToken('accentForeground'), weight: 600 } }}>
      {text}
    </Text>
  );

  const footer = (() => {
    if (stage === 'code_entry') {
      return (
        <Row justify="end" gapPx={8} style={{ layout: { width: pct(100) } }}>
          <HausButton variant="ghost" disabled={busy} onPress={onCancel}>
            <Text size={12.5}>Cancel</Text>
          </HausButton>
          <HausButton
            id="commissioning-start"
            variant="primary"
            disabled={!detected.valid || busy}
            onPress={onStart}
          >
            {primaryLabel(busy ? 'Starting…' : 'Start setup')}
          </HausButton>
        </Row>
      );
    }
    if (stage === 'credentials') {
      return (
        <Row justify="end" gapPx={8} style={{ layout: { width: pct(100) } }}>
          <HausButton variant="ghost" disabled={busy} onPress={onCancel}>
            <Text size={12.5}>Cancel</Text>
          </HausButton>
          <HausButton
            id="commissioning-submit-creds"
            variant="primary"
            disabled={busy || !ssid.trim()}
            onPress={() =>
              onSubmitCredentials({
                ssid: ssid.trim(),
                password,
                ...(threadDataset.trim() ? { threadDataset: threadDataset.trim() } : {}),
                saveForReuse,
              })
            }
          >
            {primaryLabel(busy ? 'Connecting…' : 'Continue')}
          </HausButton>
        </Row>
      );
    }
    if (stage === 'complete') {
      return (
        <Row justify="end" style={{ layout: { width: pct(100) } }}>
          <HausButton id="commissioning-finish" variant="primary" disabled={busy} onPress={onFinish}>
            {primaryLabel(busy ? 'Saving…' : 'Done')}
          </HausButton>
        </Row>
      );
    }
    if (stage === 'error') {
      return (
        <Row justify="end" gapPx={8} style={{ layout: { width: pct(100) } }}>
          <HausButton variant="ghost" onPress={onCancel}>
            <Text size={12.5}>Close</Text>
          </HausButton>
          <HausButton id="commissioning-retry" variant="primary" onPress={onRetry}>
            {primaryLabel('Try again')}
          </HausButton>
        </Row>
      );
    }
    return (
      <Row justify="end" style={{ layout: { width: pct(100) } }}>
        <HausButton variant="ghost" disabled={busy} onPress={onCancel}>
          <Text size={12.5}>Cancel</Text>
        </HausButton>
      </Row>
    );
  })();

  return (
    <HausDialog
      size="md"
      title={stageTitle(stage)}
      scrollable
      onClose={() => {
        if (!busy) onCancel();
      }}
      footer={footer}
    >
      <Stack gapPx={14} style={{ layout: { width: pct(100) } }}>
        {stage === 'code_entry' && (
          <CommissioningCodeStep
            rawCode={rawCode}
            detected={detected}
            demo={demo}
            busy={busy}
            borderColor={badgeBorder(detected.badgeTone)}
            onCodeChange={onCodeChange}
            onStart={onStart}
          />
        )}

        {stage === 'candidate_selection' && (
          <Stack gapPx={8}>
            <Text size={12.5} tone="muted">
              Multiple nearby devices matched your setup code. Choose one to pair:
            </Text>
            {candidates.map((cand) => (
              <Row
                key={cand.identifier}
                align="center"
                justify="between"
                gapPx={12}
                style={{
                  layout: { width: pct(100), padding: insets(12, 14) },
                  material: new SolidMaterial(colorToken('surfaceSecondary')),
                  border: { width: 1, color: colorToken('border') },
                  corners: corners(12),
                }}
              >
                <Stack gapPx={2} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
                  <Text size={13} weight={600}>
                    {cand.name || cand.identifier}
                  </Text>
                  <Text size={11.5} tone="muted">
                    {[
                      cand.protocol.toUpperCase(),
                      cand.transport.toUpperCase(),
                      cand.address,
                      cand.rssi !== undefined ? `${cand.rssi} dBm` : undefined,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                </Stack>
                <HausButton
                  id={`commissioning-candidate-${cand.identifier}`}
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onPress={() => onSelectCandidate(cand.identifier)}
                >
                  <Text size={12}>Pair</Text>
                </HausButton>
              </Row>
            ))}
          </Stack>
        )}

        {stage === 'credentials' && (
          <CommissioningCredentialsStep
            ssid={ssid}
            password={password}
            showPassword={showPassword}
            threadDataset={threadDataset}
            requiresThread={requiresThread}
            saveForReuse={saveForReuse}
            busy={busy}
            onChangeSsid={setSsid}
            onChangePassword={setPassword}
            onToggleShowPassword={() => setShowPassword((prev) => !prev)}
            onChangeThreadDataset={setThreadDataset}
            onChangeSaveForReuse={setSaveForReuse}
          />
        )}

        {stage === 'pairing' && (
          <Stack gapPx={10}>
            <Row align="center" gapPx={8}>
              <UiIcon name="loader-circle" size={16} />
              <Text size={13} weight={600}>
                {statusMessage || 'Establishing secure local pairing session…'}
              </Text>
            </Row>
            <ScrollView
              style={{
                layout: { width: pct(100), maxHeight: px(200), padding: insets(10, 12) },
                material: new SolidMaterial(colorToken('surfaceSecondary')),
                border: { width: 1, color: colorToken('border') },
                corners: corners(12),
              }}
            >
              <Stack gapPx={6}>
                {events.length > 0 ? (
                  events.map((evt) => (
                    <Text key={evt.seq} size={11.5} mono tone="muted">
                      {evt.message || evt.type}
                    </Text>
                  ))
                ) : (
                  <Text size={11.5} mono tone="muted">
                    Waiting for device response…
                  </Text>
                )}
              </Stack>
            </ScrollView>
          </Stack>
        )}

        {stage === 'complete' && (
          <Stack gapPx={12}>
            <Row
              align="center"
              gapPx={10}
              style={{
                layout: { width: pct(100), padding: insets(14) },
                material: new SolidMaterial(rgba(52, 211, 153, 0.12)),
                border: { width: 1, color: rgba(52, 211, 153, 0.36) },
                corners: corners(12),
              }}
            >
              <UiIcon name="check-circle" size={18} color="#34d399" />
              <Stack gapPx={2} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
                <Text size={13.5} weight={600}>
                  Pairing complete
                </Text>
                <Text size={12} tone="muted">
                  {pairedDevices.length > 0
                    ? pairedDevices.map((d) => d.name).join(', ')
                    : 'Your accessory is now available in Haus.'}
                </Text>
              </Stack>
            </Row>
            {rooms.length > 0 && (
              <Stack gapPx={6}>
                <Text size={12} weight={600}>
                  Assign to room (optional)
                </Text>
                <Row gapPx={8} wrap>
                  {rooms.map((room) => {
                    const active = selectedRoomId === room.id;
                    return (
                      <Pressable
                        key={room.id}
                        id={`commissioning-room-${room.id}`}
                        ariaPressed={active}
                        onActivate={() => onSelectRoom(active ? '' : room.id)}
                        style={{
                          layout: { padding: insets(6, 12) },
                          material: new SolidMaterial(
                            active ? colorToken('surfaceActive') : colorToken('surfaceSecondary'),
                          ),
                          border: { width: 1, color: active ? colorToken('accent') : colorToken('border') },
                          corners: corners(999),
                        }}
                      >
                        <Text size={12} weight={active ? 600 : 500}>
                          {room.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </Row>
              </Stack>
            )}
          </Stack>
        )}

        {stage === 'error' && (
          <Stack
            gapPx={8}
            style={{
              layout: { width: pct(100), padding: insets(14) },
              material: new SolidMaterial(colorToken('surfaceSecondary')),
              border: { width: 1, color: colorToken('critical') },
              corners: corners(12),
            }}
          >
            <Row align="center" gapPx={8}>
              <UiIcon name="alert-circle" size={16} />
              <Text size={13} weight={600} tone="critical">
                {errorMessage || 'Device setup failed'}
              </Text>
            </Row>
            {actionableHint && <Text size={12} tone="muted">{actionableHint}</Text>}
          </Stack>
        )}
      </Stack>
    </HausDialog>
  );
}
