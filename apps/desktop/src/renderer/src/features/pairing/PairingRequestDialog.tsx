/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { Button } from '@heroui/react';
import { ShieldCheck, KeyRound, Copy, Check } from 'lucide-react';
import { useState } from 'react';
import { Dialog } from '../../components/ui/Dialog.js';
import type { PendingPairingRequest } from './types.js';

function formatCode(raw: string): string {
  const clean = raw.trim();
  if (clean.length === 8) {
    return `${clean.slice(0, 4)} - ${clean.slice(4)}`;
  }
  return clean;
}

export function PairingRequestDialog({
  request,
  onDismiss,
}: {
  request: PendingPairingRequest;
  onDismiss: (sessionId: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const formatted = formatCode(request.challengeCode);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(request.challengeCode.trim());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard write not permitted
    }
  };

  return (
    <Dialog
      title="New device wants to pair"
      onClose={() => onDismiss(request.sessionId)}
      className="connect-dialog pairing-request-dialog"
    >
      <div className="connect-illustration">
        <span />
        <ShieldCheck size={55} strokeWidth={1.2} />
        <i>
          <KeyRound size={19} />
        </i>
      </div>
      <p className="dialog-description">
        A new device is trying to connect to your Haus Hub. Enter this code on the new device to
        approve the connection.
      </p>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 12,
          margin: '20px 0',
          padding: '16px',
          background: 'var(--heroui-content2, rgba(255,255,255,0.06))',
          borderRadius: 16,
          border: '1px solid var(--heroui-divider, rgba(255,255,255,0.1))',
        }}
      >
        <div style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: 1.2, opacity: 0.7 }}>
          One-Time Pairing Code
        </div>
        <div
          style={{
            fontSize: 32,
            fontWeight: 700,
            letterSpacing: 4,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            userSelect: 'all',
          }}
        >
          {formatted}
        </div>
        <Button size="sm" variant="secondary" onPress={() => void copyCode()}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? 'Copied' : 'Copy code'}
        </Button>
      </div>

      <p className="input-hint" style={{ textAlign: 'center', marginTop: 8 }}>
        This request expires in 5 minutes. Do not share this code with anyone outside your home.
      </p>

      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
        <Button
          variant="ghost"
          onPress={() => onDismiss(request.sessionId)}
          style={{ minWidth: 120 }}
        >
          Dismiss
        </Button>
      </div>
    </Dialog>
  );
}
