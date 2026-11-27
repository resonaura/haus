/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useState } from 'react';
import { colorToken, corners, insets, pct, px } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import type { UiStyleSpec } from '../../ir/node.js';
import {
  Box,
  CheckboxInput,
  HausButton,
  HausDialog,
  Pressable,
  Row,
  Stack,
  Text,
} from '../../primitives/index.js';
import { ConnectionField } from '../field.js';
import { UiIcon } from '../icon.js';
import { OperationProgressPanel } from './operation-progress.js';

export interface DiscoveredClusterHubCandidate {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly hubId?: string;
  readonly homeId?: string;
  readonly onboarded?: boolean;
}

export interface AddClusterHubSubmitInput {
  readonly targetUrl: string;
  readonly name?: string;
  readonly roles: readonly string[];
  readonly pairingCode?: string;
  readonly challengeSessionId?: string;
}

export type AddClusterHubSubmitResult =
  | { readonly status: 'joined'; readonly hubName?: string; readonly logs?: readonly string[] }
  | {
      readonly status: 'pairing_code_required';
      readonly challengeSessionId: string;
      readonly targetName?: string;
      readonly logs?: readonly string[];
    };

const candidateStyle: UiStyleSpec = {
  layout: {
    direction: 'row',
    alignItems: 'center',
    width: pct(100),
    padding: insets(10, 12),
    gap: px(12),
  },
  material: new SolidMaterial(colorToken('card')),
  border: { width: 1, color: colorToken('border') },
  corners: corners(14),
  states: { hover: { material: new SolidMaterial(colorToken('surfaceHover')) } },
};

const fieldStyle: UiStyleSpec = {
  layout: { minHeight: px(38), padding: insets(8, 10) },
  corners: corners(10),
  border: { width: 1, color: colorToken('border') },
  material: new SolidMaterial(colorToken('surface')),
  typography: { color: colorToken('textPrimary'), size: 13.5 },
};

export function AddClusterHubModal({
  open,
  candidates,
  scanning,
  onRescan,
  onSubmit,
  onClose,
}: {
  readonly open: boolean;
  readonly candidates: readonly DiscoveredClusterHubCandidate[];
  readonly scanning?: boolean;
  readonly onRescan?: () => void;
  readonly onSubmit: (input: AddClusterHubSubmitInput) => Promise<AddClusterHubSubmitResult>;
  readonly onClose: () => void;
}) {
  const [targetUrl, setTargetUrl] = useState('');
  const [name, setName] = useState('');
  const [storage, setStorage] = useState(true);
  const [stream, setStream] = useState(true);
  const [pairingCode, setPairingCode] = useState('');
  const [challengeSessionId, setChallengeSessionId] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<{
    title: string;
    detail?: string;
    percent: number;
    state: 'running' | 'complete' | 'failed';
    logs: readonly string[];
  }>();

  if (!open) return null;

  const roles = [...(storage ? ['storage'] : []), ...(stream ? ['stream'] : [])];
  const canSubmit =
    !busy &&
    roles.length > 0 &&
    Boolean(targetUrl.trim()) &&
    (!challengeSessionId || Boolean(pairingCode.trim()));

  const handleEnroll = async (overrideUrl?: string, overrideName?: string) => {
    const effectiveUrl = (overrideUrl ?? targetUrl).trim();
    if (!effectiveUrl || roles.length === 0) return;
    setBusy(true);
    setError('');
    const initialLogs = [
      `[CLUSTER] Probing target Hub at ${effectiveUrl}…`,
      challengeSessionId
        ? '[INFO] Confirming administrator pairing code & exchanging Ed25519/X25519 peer keys…'
        : '[INFO] Requesting one-click cluster enrollment & mutual key exchange…',
    ];
    setProgress({
      title: 'Joining Hub to Home network…',
      detail: `Connecting ${effectiveUrl} (${roles.join(', ')})`,
      percent: 38,
      state: 'running',
      logs: initialLogs,
    });
    try {
      const result = await onSubmit({
        targetUrl: effectiveUrl,
        ...(overrideName?.trim() || name.trim() ? { name: (overrideName ?? name).trim() } : {}),
        roles,
        ...(challengeSessionId ? { challengeSessionId, pairingCode: pairingCode.trim() } : {}),
      });
      if (result.status === 'pairing_code_required') {
        setTargetUrl(effectiveUrl);
        if (result.targetName && !name.trim()) setName(result.targetName);
        setChallengeSessionId(result.challengeSessionId);
        setProgress({
          title: 'Authorization code required',
          detail: 'Target Hub already has an admin session — enter its 8-character pairing code.',
          percent: 60,
          state: 'running',
          logs: [
            ...initialLogs,
            ...(result.logs ?? []),
            '[WARN] Target Hub requires pairing code confirmation before joining.',
          ],
        });
        return;
      }
      setProgress({
        title: 'Hub joined Home network',
        detail: result.hubName ? `${result.hubName} is now active.` : 'Cluster mesh updated.',
        percent: 100,
        state: 'complete',
        logs: [...initialLogs, ...(result.logs ?? []), '[OK] Peer keys verified & cluster synced.'],
      });
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not add Hub to Home network.';
      setError(msg);
      setProgress({
        title: 'Failed to add Hub',
        detail: msg,
        percent: 100,
        state: 'failed',
        logs: [...initialLogs, `[ERROR] ${msg}`],
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <HausDialog
      open={open}
      title="Add a Hub to your Home"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <Stack gapPx={14} style={{ layout: { width: pct(100) } }}>
        <Text size={12.5} tone="muted">
          Expand your Home network with another Haus Hub for automatic failover, camera storage, and
          distributed workloads. Unconfigured Hubs join in one click.
        </Text>

        {!challengeSessionId && (
          <Stack gapPx={8}>
            <Row align="center" justify="between">
              <Row align="center" gapPx={6}>
                <UiIcon name={scanning ? 'loader-circle' : 'radio'} size={14} />
                <Text size={11} weight={600} tone="muted">
                  {scanning
                    ? 'SCANNING LOCAL NETWORK…'
                    : candidates.length > 0
                      ? 'AVAILABLE HUBS ON YOUR NETWORK'
                      : 'ENTER HUB ADDRESS'}
                </Text>
              </Row>
              {onRescan && (
                <HausButton
                  id="add-hub-rescan"
                  variant="ghost"
                  size="sm"
                  disabled={busy || scanning}
                  onPress={onRescan}
                >
                  {scanning ? 'Scanning…' : 'Rescan'}
                </HausButton>
              )}
            </Row>

            {candidates.map((candidate) => (
              <Pressable
                key={candidate.id || candidate.url}
                id={`enroll-candidate-${candidate.id}`}
                style={candidateStyle}
                disabled={busy}
                onActivate={() => {
                  setTargetUrl(candidate.url);
                  if (!name.trim() && candidate.name !== 'Haus Hub') setName(candidate.name);
                  if (candidate.onboarded === false) {
                    void handleEnroll(
                      candidate.url,
                      name.trim() || (candidate.name !== 'Haus Hub' ? candidate.name : undefined),
                    );
                  }
                }}
              >
                <Box
                  style={{
                    layout: {
                      width: px(34),
                      height: px(34),
                      alignItems: 'center',
                      justifyContent: 'center',
                    },
                    material: new SolidMaterial(colorToken('surfaceSecondary')),
                    corners: corners(10),
                  }}
                >
                  <UiIcon name="server" size={16} />
                </Box>
                <Stack gapPx={2} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
                  <Row align="center" gapPx={8}>
                    <Text size={13} weight={600}>
                      {candidate.name}
                    </Text>
                    <Text size={10.5} weight={600} tone="muted">
                      {candidate.onboarded === false ? 'Ready · One-click join' : 'Requires code'}
                    </Text>
                  </Row>
                  <Text size={11.5} tone="muted">
                    {candidate.url}
                  </Text>
                </Stack>
                <UiIcon name="plus" size={16} />
              </Pressable>
            ))}
          </Stack>
        )}

        <Stack gapPx={10}>
          <ConnectionField
            id="enroll-hub-url"
            label="Hub local address"
            placeholder="http://192.168.5.115:8790"
            value={targetUrl}
            onChange={(val) => {
              setTargetUrl(val);
              setChallengeSessionId(undefined);
            }}
            disabled={busy}
            style={fieldStyle}
          />
          <ConnectionField
            id="enroll-hub-name"
            label="Hub name (optional)"
            placeholder="Office Hub"
            value={name}
            onChange={setName}
            disabled={busy}
            style={fieldStyle}
          />
          {challengeSessionId && (
            <ConnectionField
              id="enroll-hub-code"
              label="Target Hub pairing code"
              placeholder="8-character code from target Hub"
              hint="This Hub already has an admin session. Enter its pairing code to authorize joining your Home."
              value={pairingCode}
              onChange={setPairingCode}
              disabled={busy}
              autoFocus
              style={fieldStyle}
            />
          )}
        </Stack>

        <Row align="center" gapPx={16} wrap>
          <Row align="center" gapPx={8}>
            <CheckboxInput
              id="enroll-role-storage"
              ariaLabel="Camera & backup storage"
              checked={storage}
              disabled={busy}
              onChange={setStorage}
            />
            <Text size={12.5}>Camera & backup storage</Text>
          </Row>
          <Row align="center" gapPx={8}>
            <CheckboxInput
              id="enroll-role-stream"
              ariaLabel="Live streaming assist"
              checked={stream}
              disabled={busy}
              onChange={setStream}
            />
            <Text size={12.5}>Live streaming assist</Text>
          </Row>
        </Row>

        {progress && (
          <OperationProgressPanel
            id="enroll-hub-progress"
            title={progress.title}
            detail={progress.detail}
            percent={progress.percent}
            state={progress.state}
            logs={progress.logs}
          />
        )}

        {error && !progress && (
          <Text size={12} tone="critical" role="alert">
            {error}
          </Text>
        )}

        <Row align="center" justify="end" gapPx={8}>
          <HausButton variant="ghost" disabled={busy} onPress={onClose}>
            Cancel
          </HausButton>
          <HausButton
            id="enroll-hub-submit"
            disabled={!canSubmit}
            onPress={() => void handleEnroll()}
          >
            {busy ? 'Joining Home…' : challengeSessionId ? 'Confirm & Join Home' : 'Add to Home'}
          </HausButton>
        </Row>
      </Stack>
    </HausDialog>
  );
}
