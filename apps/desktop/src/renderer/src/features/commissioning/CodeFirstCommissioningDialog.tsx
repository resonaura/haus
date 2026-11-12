/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useState } from 'react';
import { Button } from '@heroui/react';
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
import { Dialog } from '../../components/ui/Dialog.js';
import type { Snapshot } from '../../model/index.js';
import { rest } from '../../ha/management.js';
import { useCommissioningSession } from './useCommissioningSession.js';

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
        await rest(
          'POST',
          `devices/${encodeURIComponent(firstDevice.id)}/move-room`,
          { targetRoomId: selectedRoom },
        );
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
        <div className="flow-prepare">
          <p className="dialog-description">
            Scan a Matter QR code, or enter an 8-digit HomeKit PIN, 11-digit Matter manual code,
            Improv, or vendor code.
          </p>

          <label className="management-field">
            <span>Setup Code or PIN</span>
            <div className="code-input-wrapper" style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                autoFocus
                value={session.rawCode}
                placeholder="e.g. MT:Y.K9042C00KA0648G00 or 123-45-678"
                onChange={(e) => session.setCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && session.detected.valid && !session.isSubmitting) {
                    void session.startCommissioning();
                  }
                }}
                disabled={session.isSubmitting}
                style={{ flex: 1, fontFamily: 'monospace' }}
              />
            </div>
          </label>

          {/* Protocol detection badge */}
          <div
            className={`protocol-badge-box variant-${session.detected.badgeVariant}`}
            style={{
              padding: '12px',
              borderRadius: '8px',
              margin: '12px 0',
              background: 'var(--haus-card-subtle, rgba(255,255,255,0.04))',
              border: '1px solid var(--haus-border, rgba(255,255,255,0.1))',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <KeyRound size={16} />
              <strong>{session.detected.label}</strong>
            </div>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', opacity: 0.85 }}>
              {session.detected.description}
            </p>
            {session.detected.honestLimitation && (
              <p
                style={{
                  margin: '8px 0 0 0',
                  fontSize: '0.82rem',
                  color: 'var(--haus-warning, #f59e0b)',
                }}
              >
                {session.detected.honestLimitation}
              </p>
            )}
          </div>

          <div
            className="registry-dialog-actions"
            style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}
          >
            <Button variant="ghost" onPress={onClose} isDisabled={session.isSubmitting}>
              Cancel
            </Button>
            <Button
              onPress={() => void session.startCommissioning()}
              isDisabled={!session.detected.valid || session.isSubmitting}
              isPending={session.isSubmitting}
            >
              Start setup <ArrowRight size={16} />
            </Button>
          </div>
        </div>
      )}

      {/* STAGE 2: Candidate selection */}
      {session.stage === 'candidate_selection' && (
        <div className="flow-candidates">
          <p className="dialog-description">
            Multiple devices were discovered nearby matching your code. Select the one to pair:
          </p>
          <div className="candidate-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px', margin: '12px 0' }}>
            {session.candidates.map((cand) => (
              <div
                key={cand.identifier}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '12px',
                  borderRadius: '8px',
                  background: 'var(--haus-card-subtle, rgba(255,255,255,0.04))',
                  border: '1px solid var(--haus-border, rgba(255,255,255,0.1))',
                }}
              >
                <div>
                  <strong>{cand.name || cand.identifier}</strong>
                  <div style={{ fontSize: '0.8rem', opacity: 0.7, marginTop: '2px' }}>
                    {cand.protocol.toUpperCase()} · {cand.transport.toUpperCase()}
                    {cand.address ? ` · ${cand.address}` : ''}
                    {cand.rssi !== undefined ? ` · ${cand.rssi} dBm` : ''}
                  </div>
                </div>
                <Button
                  size="sm"
                  onPress={() => void session.selectCandidate(cand.identifier)}
                  isDisabled={session.isSubmitting}
                >
                  Pair <ArrowRight size={14} />
                </Button>
              </div>
            ))}
          </div>
          <div className="registry-dialog-actions" style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
            <Button variant="ghost" onPress={() => void session.cancelCommissioning()}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* STAGE 3: Just-in-time network credentials */}
      {session.stage === 'credentials' && (
        <div className="flow-credentials">
          <p className="dialog-description">
            {session.promptCredentials?.reason ||
              'This device requires Wi-Fi network credentials to join your local network.'}
          </p>

          <label className="management-field" style={{ marginTop: '12px' }}>
            <span>Wi-Fi Network (SSID)</span>
            <input
              type="text"
              value={ssid}
              placeholder={session.promptCredentials?.suggestedSsid || 'Network SSID'}
              onChange={(e) => setSsid(e.target.value)}
              disabled={session.isSubmitting}
            />
          </label>

          <label className="management-field" style={{ marginTop: '12px' }}>
            <span>Wi-Fi Password</span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                placeholder="Network password"
                onChange={(e) => setPassword(e.target.value)}
                disabled={session.isSubmitting}
                style={{ flex: 1 }}
              />
              <Button
                variant="secondary"
                size="sm"
                onPress={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </Button>
            </div>
          </label>

          {session.promptCredentials?.kind === 'thread' && (
            <label className="management-field" style={{ marginTop: '12px' }}>
              <span>Thread Active Operational Dataset (Hex)</span>
              <input
                type="text"
                value={threadDataset}
                placeholder="Optional Thread dataset hex"
                onChange={(e) => setThreadDataset(e.target.value)}
                disabled={session.isSubmitting}
                style={{ fontFamily: 'monospace' }}
              />
            </label>
          )}

          <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="checkbox"
              id="saveForReuse"
              checked={saveForReuse}
              onChange={(e) => setSaveForReuse(e.target.checked)}
              disabled={session.isSubmitting}
            />
            <label htmlFor="saveForReuse" style={{ fontSize: '0.85rem', cursor: 'pointer' }}>
              Remember network credentials securely on Hub for future devices
            </label>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '0.78rem',
              opacity: 0.7,
              marginTop: '12px',
            }}
          >
            <ShieldCheck size={14} />
            <span>Transmitted securely; transient password wiped from memory after setup.</span>
          </div>

          <div
            className="registry-dialog-actions"
            style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}
          >
            <Button
              variant="ghost"
              onPress={() => void session.cancelCommissioning()}
              isDisabled={session.isSubmitting}
            >
              Cancel
            </Button>
            <Button
              onPress={() =>
                void session.submitCredentials(
                  ssid.trim() || (session.promptCredentials?.suggestedSsid ?? ''),
                  password,
                  threadDataset.trim() || undefined,
                  saveForReuse,
                )
              }
              isDisabled={session.isSubmitting || (!ssid.trim() && !session.promptCredentials?.suggestedSsid)}
              isPending={session.isSubmitting}
            >
              Connect device <Wifi size={16} />
            </Button>
          </div>
        </div>
      )}

      {/* STAGE 4: Pairing progress */}
      {session.stage === 'pairing' && (
        <div className="flow-pairing" style={{ padding: '8px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <Radio className="spin-slow" size={24} />
            <div>
              <strong>Establishing secure pairing…</strong>
              <div style={{ fontSize: '0.85rem', opacity: 0.75 }}>
                {session.events.length > 0
                  ? session.events[session.events.length - 1]!.message
                  : 'Initializing secure transport…'}
              </div>
            </div>
          </div>

          <div
            className="event-timeline"
            style={{
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
              <div key={evt.seq} style={{ opacity: 0.85 }}>
                <span style={{ opacity: 0.5, marginRight: '6px' }}>
                  {new Date(evt.timestamp).toLocaleTimeString()}
                </span>
                {evt.message}
              </div>
            ))}
          </div>

          <div
            className="registry-dialog-actions"
            style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}
          >
            <Button variant="ghost" onPress={() => void session.cancelCommissioning()}>
              Cancel setup
            </Button>
          </div>
        </div>
      )}

      {/* STAGE 5: Complete */}
      {session.stage === 'complete' && (
        <div className="flow-complete" style={{ textAlign: 'center', padding: '12px 0' }}>
          <CheckCircle2
            size={48}
            style={{ color: 'var(--haus-success, #22c55e)', margin: '0 auto 12px auto' }}
          />
          <h3>Device added successfully</h3>
          <p className="dialog-description" style={{ marginBottom: '16px' }}>
            Your device is now connected to Haus and ready to use.
          </p>

          <label className="management-field" style={{ textAlign: 'left', margin: '16px 0' }}>
            <span>Assign to room</span>
            <select
              value={selectedRoom}
              onChange={(e) => setSelectedRoom(e.target.value)}
              disabled={movingRoom}
            >
              <option value="">Choose a room (optional)</option>
              {snapshot.areas.map((area) => (
                <option key={area.area_id} value={area.area_id}>
                  {area.name}
                </option>
              ))}
            </select>
          </label>

          <div
            className="registry-dialog-actions"
            style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}
          >
            <Button onPress={() => void handleFinish()} isPending={movingRoom}>
              Done
            </Button>
          </div>
        </div>
      )}

      {/* STAGE 6: Error / Actionable failure */}
      {session.stage === 'error' && (
        <div className="flow-error">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--haus-danger, #ef4444)' }}>
            <AlertTriangle size={24} />
            <strong>Could not complete setup</strong>
          </div>
          <p style={{ marginTop: '8px', fontSize: '0.9rem' }}>{session.errorMessage}</p>

          {session.actionableHint && (
            <div
              style={{
                marginTop: '12px',
                padding: '10px',
                borderRadius: '6px',
                background: 'var(--haus-card-subtle, rgba(255,255,255,0.04))',
                border: '1px solid var(--haus-border, rgba(255,255,255,0.1))',
                fontSize: '0.85rem',
              }}
            >
              <strong>What to try:</strong>
              <p style={{ margin: '4px 0 0 0', opacity: 0.9 }}>{session.actionableHint}</p>
            </div>
          )}

          <div
            className="registry-dialog-actions"
            style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}
          >
            <Button variant="ghost" onPress={onClose}>
              Cancel
            </Button>
            <Button onPress={session.retry}>
              <RefreshCw size={14} /> Try again
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
