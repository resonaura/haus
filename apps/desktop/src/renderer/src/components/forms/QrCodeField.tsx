/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useMemo, useState } from 'react';
import { Box, HausButton, HausCode, Text, VectorGraphic } from '@haus/ui';
import { Check, Copy } from 'lucide-react';
import QRCode from 'qrcode';

function normalizeErrorCorrectionLevel(level: unknown): 'L' | 'M' | 'Q' | 'H' {
  const normalized = typeof level === 'string' ? level.trim().toUpperCase() : '';
  if (normalized === 'L' || normalized === 'LOW') return 'L';
  if (normalized === 'Q' || normalized === 'QUARTILE') return 'Q';
  if (normalized === 'H' || normalized === 'HIGH') return 'H';
  return 'M';
}

export function QrCodeField({
  label,
  data,
  description,
  errorCorrectionLevel,
  showLink = true,
}: {
  label: string;
  data: string;
  description?: string;
  errorCorrectionLevel?: unknown;
  showLink?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const qr = useMemo(() => {
    const trimmed = data.trim();
    if (!trimmed) return null;
    try {
      const { modules } = QRCode.create(trimmed, {
        errorCorrectionLevel: normalizeErrorCorrectionLevel(errorCorrectionLevel),
      });
      const paths: string[] = [];
      for (let row = 0; row < modules.size; row += 1) {
        for (let col = 0; col < modules.size; col += 1) {
          if (modules.get(row, col)) paths.push(`M${col + 2} ${row + 2}h1v1h-1z`);
        }
      }
      return { size: modules.size + 4, path: paths.join('') };
    } catch {
      return null;
    }
  }, [data, errorCorrectionLevel]);

  const copyPayload = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* ignore clipboard unavailability */
    }
  };

  return (
    <Box className="management-field management-qr-field">
      <Text>{label}</Text>
      {description && (
        <Text semantic="small" className="management-field-desc">
          {description}
        </Text>
      )}
      {qr ? (
        <Box className="flow-qr-box">
          <VectorGraphic
            viewWidth={qr.size}
            viewHeight={qr.size}
            background="#ffffff"
            backgroundRadius={1}
            paths={[{ d: qr.path, fill: '#111111' }]}
            role="img"
            ariaLabel={label}
            className="flow-qr-svg"
          />
          {showLink && (
            <Box className="flow-qr-meta">
              <HausCode>{data}</HausCode>
              <HausButton
                type="button"
                size="sm"
                variant="secondary"
                onPress={() => void copyPayload()}
              >
                {copied ? <Check size={13} /> : <Copy size={13} />}
                {copied ? 'Copied' : 'Copy link'}
              </HausButton>
            </Box>
          )}
        </Box>
      ) : (
        <Text semantic="p" className="management-hint">
          Waiting for QR code payload from integration...
        </Text>
      )}
    </Box>
  );
}
