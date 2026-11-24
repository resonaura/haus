/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useEffect, useState } from 'react';
import { colorToken, corners, insets, pct, px } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import { Box, HausButton, Row, Stack, Text } from '../../primitives/index.js';
import { Dialog } from '../dialog.js';
import { UiIcon } from '../icon.js';

export interface PortablePairingRequest {
  readonly sessionId: string;
  readonly challengeCode: string;
  readonly expiresAt?: string;
}

function formatCode(raw: string): string {
  const clean = raw.trim();
  return clean.length === 8 ? `${clean.slice(0, 4)} - ${clean.slice(4)}` : clean;
}

export function PortablePairingRequestDialog({
  request,
  onCopy,
  onDismiss,
}: {
  readonly request: PortablePairingRequest;
  readonly onCopy?: (code: string) => Promise<boolean> | boolean;
  readonly onDismiss: (sessionId: string) => void;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const handleCopy = async () => {
    const code = request.challengeCode.trim();
    if (!onCopy) return;
    try {
      const ok = await onCopy(code);
      if (ok) setCopied(true);
    } catch {
      /* Clipboard write failure is non-fatal; the user can type the code directly. */
    }
  };

  return (
    <Dialog title="New device wants to pair" onClose={() => onDismiss(request.sessionId)}>
      <Stack align="center" gapPx={14} style={{ layout: { width: pct(100) } }}>
        <Row
          align="center"
          justify="center"
          gapPx={8}
          style={{
            layout: { padding: insets(12, 16) },
            material: new SolidMaterial(colorToken('soft')),
            corners: corners(18),
          }}
        >
          <UiIcon name="shield-check" size={30} />
          <UiIcon name="key-round" size={20} />
        </Row>
        <Text tone="muted" size={13}>
          A new device is trying to connect to your Haus Hub. Enter this code on the new device to
          approve the connection.
        </Text>
        <Stack
          align="center"
          gapPx={10}
          style={{
            layout: { width: pct(100), padding: insets(16) },
            material: new SolidMaterial(colorToken('surface')),
            border: { width: 1, color: colorToken('border') },
            corners: corners(16),
          }}
        >
          <Text tone="muted" size={11} weight={600} style={{ typography: { letterSpacing: 1.1 } }}>
            ONE-TIME PAIRING CODE
          </Text>
          <Text mono size={28} weight={700} style={{ typography: { size: 28, letterSpacing: 3 } }}>
            {formatCode(request.challengeCode)}
          </Text>
          {onCopy && (
            <HausButton
              id="pairing-copy-code"
              size="sm"
              variant="secondary"
              onPress={() => void handleCopy()}
            >
              <Row align="center" gapPx={6}>
                <UiIcon name={copied ? 'check' : 'copy'} size={14} />
                {copied ? 'Copied' : 'Copy code'}
              </Row>
            </HausButton>
          )}
        </Stack>
        <Text tone="muted" size={12}>
          This request expires in 5 minutes. Do not share this code with anyone outside your home.
        </Text>
        <Box style={{ layout: { width: pct(100), padding: insets(4, 0, 0, 0) } }}>
          <Row justify="end" style={{ layout: { width: pct(100), gap: px(8) } }}>
            <HausButton
              id="pairing-dismiss"
              variant="ghost"
              onPress={() => onDismiss(request.sessionId)}
            >
              Dismiss
            </HausButton>
          </Row>
        </Box>
      </Stack>
    </Dialog>
  );
}
