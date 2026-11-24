/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useState } from 'react';
import { Box, CheckboxInput, HausButton, Heading, SelectInput, Text, TextInput } from '@haus/ui';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Radio,
  RefreshCw,
  ShieldCheck,
  Wifi,
} from 'lucide-react';
import { Dialog } from '@haus/ui/components';
import type { Snapshot } from '../../model/index.js';
import { rest } from '../../ha/management.js';
import { useCommissioningSession } from './useCommissioningSession.js';

const CARD_SURFACE = {
  padding: '12px',
  borderRadius: '8px',
  background: 'var(--haus-card-subtle, rgba(255,255,255,0.04))',
  border: '1px solid var(--haus-border, rgba(255,255,255,0.1))',
};
const ACTIONS_ROW = { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' };

export interface CodeFirstCommissioningDialogProps {
  readonly snapshot: Snapshot;
  readonly onClose: () => void;
  readonly onDone: () => void;
  readonly initialCode?: string;
}

export function CodeFirstCommissioningDialog({
  snapshot,
  onClose,
  onDone,
  initialCode = '',
}: CodeFirstCommissioningDialogProps) {
  const session = useCommissioningSession(initialCode);

  // Network credential form state
  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [threadDataset, setThreadDataset] = useState('');
  const [saveForReuse, setSaveForReuse] = useState(true);

  // Completion room assignment state
  const [selectedRoom, setSelectedRoom] = useState('');
  const [movingRoom, setMovingRoom] = useState(false);

  const handleFinish = async () => {
    const pairedDevices = session.transaction?.pairedDevices;
    const firstDevice = pairedDevices && pairedDevices.length > 0 ? pairedDevices[0] : null;
    if (selectedRoom && firstDevice?.id) {
      setMovingRoom(true);
      try {
        await rest('POST', `devices/${encodeURIComponent(firstDevice.id)}/move-room`, {
          targetRoomId: selectedRoom,
        });
      } catch {
        // Continue even if room assignment fails
      } finally {
        setMovingRoom(false);
      }
    }
    onDone();
  };

  const dialogTitle =
    session.stage === 'complete'
      ? 'Device ready'
      : session.stage === 'error'
        ? 'Setup issue'
        : session.stage === 'candidate_selection'
          ? 'Select device'
          : session.stage === 'credentials'
            ? 'Network credentials'
            : session.stage === 'pairing'
              ? 'Pairing in progress'
              : 'Add device with setup code';

  return (
    <Dialog
      title={dialogTitle}
      onClose={() => {
        if (!session.isSubmitting && !movingRoom) {
          void session.cancelCommissioning();
          onClose();
        }
      }}
      className="commissioning-dialog"
    >
      {/* STAGE 1: Code entry */}
      {session.stage === 'code_entry' && (
        <Box className="flow-prepare">
          <Text semantic="p" className="dialog-description">
            Scan a Matter QR code, or enter an 8-digit HomeKit PIN, 11-digit Matter manual code,
            Improv, or vendor code.
          </Text>

          <Text semantic="label" className="management-field">
            <Text>Setup Code or PIN</Text>
            <Box className="code-input-wrapper" surfaceTokens={{ display: 'flex', gap: '8px' }}>
              <TextInput
                inputType="text"
                autoFocus
                value={session.rawCode}
                placeholder="e.g. MT:Y.K9042C00KA0648G00 or 123-45-678"
                onChange={(val) => session.setCode(val)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && session.detected.valid && !session.isSubmitting) {
                    void session.startCommissioning();
                  }
                }}
                disabled={session.isSubmitting}
                surfaceTokens={{ flex: 1, fontFamily: 'monospace' }}
              />
            </Box>
          </Text>

          <Box
            className={`protocol-badge-box variant-${session.detected.badgeVariant}`}
            surfaceTokens={{ ...CARD_SURFACE, margin: '12px 0' }}
          >
            <Box surfaceTokens={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <KeyRound size={16} />
              <Text semantic="strong">{session.detected.label}</Text>
            </Box>
            <Text
              semantic="p"
              surfaceTokens={{ margin: '4px 0 0 0', fontSize: '0.85rem', opacity: 0.85 }}
            >
              {session.detected.description}
            </Text>
            {session.detected.honestLimitation && (
              <Text
                semantic="p"
                surfaceTokens={{
                  margin: '8px 0 0 0',
                  fontSize: '0.82rem',
                  color: 'var(--haus-warning, #f59e0b)',
                }}
              >
                {session.detected.honestLimitation}
              </Text>
            )}
          </Box>

          <Box className="registry-dialog-actions" surfaceTokens={ACTIONS_ROW}>
            <HausButton variant="ghost" onPress={onClose} isDisabled={session.isSubmitting}>
              Cancel
            </HausButton>
            <HausButton
              onPress={() => void session.startCommissioning()}
              isDisabled={!session.detected.valid || session.isSubmitting}
              isPending={session.isSubmitting}
            >
              Start setup <ArrowRight size={16} />
            </HausButton>
          </Box>
        </Box>
      )}

      {/* STAGE 2: Candidate selection */}
      {session.stage === 'candidate_selection' && (
        <Box className="flow-candidates">
          <Text semantic="p" className="dialog-description">
            Multiple devices were discovered nearby matching your code. Select the one to pair:
          </Text>
          <Box
            className="candidate-list"
            surfaceTokens={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              margin: '12px 0',
            }}
          >
            {session.candidates.map((cand) => (
              <Box
                key={cand.identifier}
                surfaceTokens={{
                  ...CARD_SURFACE,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <Box>
                  <Text semantic="strong">{cand.name || cand.identifier}</Text>
                  <Box surfaceTokens={{ fontSize: '0.8rem', opacity: 0.7, marginTop: '2px' }}>
                    {cand.protocol.toUpperCase()} · {cand.transport.toUpperCase()}
                    {cand.address ? ` · ${cand.address}` : ''}
                    {cand.rssi !== undefined ? ` · ${cand.rssi} dBm` : ''}
                  </Box>
                </Box>
                <HausButton
                  size="sm"
                  onPress={() => void session.selectCandidate(cand.identifier)}
                  isDisabled={session.isSubmitting}
                >
                  Pair <ArrowRight size={14} />
                </HausButton>
              </Box>
            ))}
          </Box>
          <Box className="registry-dialog-actions" surfaceTokens={ACTIONS_ROW}>
            <HausButton variant="ghost" onPress={() => void session.cancelCommissioning()}>
              Cancel
            </HausButton>
          </Box>
        </Box>
      )}

      {/* STAGE 3: Just-in-time network credentials */}
      {session.stage === 'credentials' && (
        <Box className="flow-credentials">
          <Text semantic="p" className="dialog-description">
            {session.promptCredentials?.reason ||
              'This device requires Wi-Fi network credentials to join your local network.'}
          </Text>

          <Text semantic="label" className="management-field" surfaceTokens={{ marginTop: '12px' }}>
            <Text>Wi-Fi Network (SSID)</Text>
            <TextInput
              inputType="text"
              value={ssid}
              placeholder={session.promptCredentials?.suggestedSsid || 'Network SSID'}
              onChange={setSsid}
              disabled={session.isSubmitting}
            />
          </Text>

          <Text semantic="label" className="management-field" surfaceTokens={{ marginTop: '12px' }}>
            <Text>Wi-Fi Password</Text>
            <Box surfaceTokens={{ display: 'flex', gap: '8px' }}>
              <TextInput
                inputType={showPassword ? 'text' : 'password'}
                value={password}
                placeholder="Network password"
                onChange={setPassword}
                disabled={session.isSubmitting}
                surfaceTokens={{ flex: 1 }}
              />
              <HausButton
                variant="secondary"
                size="sm"
                onPress={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </HausButton>
            </Box>
          </Text>

          {session.promptCredentials?.kind === 'thread' && (
            <Text
              semantic="label"
              className="management-field"
              surfaceTokens={{ marginTop: '12px' }}
            >
              <Text>Thread Active Operational Dataset (Hex)</Text>
              <TextInput
                inputType="text"
                value={threadDataset}
                placeholder="Optional Thread dataset hex"
                onChange={setThreadDataset}
                disabled={session.isSubmitting}
                surfaceTokens={{ fontFamily: 'monospace' }}
              />
            </Text>
          )}

          <Box
            surfaceTokens={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            <CheckboxInput
              id="saveForReuse"
              checked={saveForReuse}
              onChange={setSaveForReuse}
              disabled={session.isSubmitting}
            />
            <Text
              semantic="label"
              htmlFor="saveForReuse"
              surfaceTokens={{ fontSize: '0.85rem', cursor: 'pointer' }}
            >
              Remember network credentials securely on Hub for future devices
            </Text>
          </Box>

          <Box
            surfaceTokens={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '0.78rem',
              opacity: 0.7,
              marginTop: '12px',
            }}
          >
            <ShieldCheck size={14} />
            <Text>Transmitted securely; transient password wiped from memory after setup.</Text>
          </Box>

          <Box className="registry-dialog-actions" surfaceTokens={ACTIONS_ROW}>
            <HausButton
              variant="ghost"
              onPress={() => void session.cancelCommissioning()}
              isDisabled={session.isSubmitting}
            >
              Cancel
            </HausButton>
            <HausButton
              onPress={() =>
                void session.submitCredentials(
                  ssid.trim() || (session.promptCredentials?.suggestedSsid ?? ''),
                  password,
                  threadDataset.trim() || undefined,
                  saveForReuse,
                )
              }
              isDisabled={
                session.isSubmitting || (!ssid.trim() && !session.promptCredentials?.suggestedSsid)
              }
              isPending={session.isSubmitting}
            >
              Connect device <Wifi size={16} />
            </HausButton>
          </Box>
        </Box>
      )}

      {/* STAGE 4: Pairing progress */}
      {session.stage === 'pairing' && (
        <Box className="flow-pairing" surfaceTokens={{ padding: '8px 0' }}>
          <Box
            surfaceTokens={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              marginBottom: '16px',
            }}
          >
            <Radio className="spin-slow" size={24} />
            <Box>
              <Text semantic="strong">Establishing secure pairing…</Text>
              <Box surfaceTokens={{ fontSize: '0.85rem', opacity: 0.75 }}>
                {session.events.length > 0
                  ? session.events[session.events.length - 1]!.message
                  : 'Initializing secure transport…'}
              </Box>
            </Box>
          </Box>

          <Box
            className="event-timeline"
            surfaceTokens={{
              maxHeight: '140px',
              overflowY: 'auto',
              fontSize: '0.8rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              padding: '8px',
              background: 'var(--haus-card-subtle, rgba(255,255,255,0.02))',
              borderRadius: '6px',
              border: '1px solid var(--haus-border, rgba(255,255,255,0.06))',
            }}
          >
            {session.events.slice(-4).map((evt) => (
              <Box key={evt.seq} surfaceTokens={{ opacity: 0.85 }}>
                <Text surfaceTokens={{ opacity: 0.5, marginRight: '6px' }}>
                  {new Date(evt.timestamp).toLocaleTimeString()}
                </Text>
                {evt.message}
              </Box>
            ))}
          </Box>

          <Box className="registry-dialog-actions" surfaceTokens={ACTIONS_ROW}>
            <HausButton variant="ghost" onPress={() => void session.cancelCommissioning()}>
              Cancel setup
            </HausButton>
          </Box>
        </Box>
      )}

      {/* STAGE 5: Complete */}
      {session.stage === 'complete' && (
        <Box className="flow-complete" surfaceTokens={{ textAlign: 'center', padding: '12px 0' }}>
          <CheckCircle2
            size={48}
            style={{ color: 'var(--haus-success, #22c55e)', margin: '0 auto 12px auto' }}
          />
          <Heading level={3}>Device added successfully</Heading>
          <Text
            semantic="p"
            className="dialog-description"
            surfaceTokens={{ marginBottom: '16px' }}
          >
            Your device is now connected to Haus and ready to use.
          </Text>

          <Text
            semantic="label"
            className="management-field"
            surfaceTokens={{ textAlign: 'left', margin: '16px 0' }}
          >
            <Text>Assign to room</Text>
            <SelectInput
              value={selectedRoom}
              disabled={movingRoom}
              options={[
                { value: '', label: 'Choose a room (optional)' },
                ...snapshot.areas.map((area) => ({ value: area.area_id, label: area.name })),
              ]}
              onChange={setSelectedRoom}
            />
          </Text>

          <Box className="registry-dialog-actions" surfaceTokens={ACTIONS_ROW}>
            <HausButton onPress={() => void handleFinish()} isPending={movingRoom}>
              Done
            </HausButton>
          </Box>
        </Box>
      )}

      {/* STAGE 6: Error / Actionable failure */}
      {session.stage === 'error' && (
        <Box className="flow-error">
          <Box
            surfaceTokens={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              color: 'var(--haus-danger, #ef4444)',
            }}
          >
            <AlertTriangle size={24} />
            <Text semantic="strong">Could not complete setup</Text>
          </Box>
          <Text semantic="p" surfaceTokens={{ marginTop: '8px', fontSize: '0.9rem' }}>
            {session.errorMessage}
          </Text>

          {session.actionableHint && (
            <Box
              surfaceTokens={{
                ...CARD_SURFACE,
                marginTop: '12px',
                padding: '10px',
                fontSize: '0.85rem',
              }}
            >
              <Text semantic="strong">What to try:</Text>
              <Text semantic="p" surfaceTokens={{ margin: '4px 0 0 0', opacity: 0.9 }}>
                {session.actionableHint}
              </Text>
            </Box>
          )}

          <Box className="registry-dialog-actions" surfaceTokens={ACTIONS_ROW}>
            <HausButton variant="ghost" onPress={onClose}>
              Cancel
            </HausButton>
            <HausButton onPress={session.retry}>
              <RefreshCw size={14} /> Try again
            </HausButton>
          </Box>
        </Box>
      )}
    </Dialog>
  );
}
