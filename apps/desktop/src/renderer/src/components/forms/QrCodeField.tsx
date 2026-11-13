/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useMemo, useState } from 'react';
import { Button } from '@heroui/react';
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
}: {
  label: string;
  data: string;
  description?: string;
  errorCorrectionLevel?: unknown;
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
  }, [data]);

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
    <div className="management-field management-qr-field">
      <span>{label}</span>
      {description && <small className="management-field-desc">{description}</small>}
      {qr ? (
        <div className="flow-qr-box">
          <svg
            viewBox={`0 0 ${qr.size} ${qr.size}`}
            role="img"
            aria-label={label}
            className="flow-qr-svg"
          >
            <rect width={qr.size} height={qr.size} fill="#ffffff" rx={1} />
            <path d={qr.path} fill="#111111" />
          </svg>
          <div className="flow-qr-meta">
            <code>{data}</code>
            <Button type="button" size="sm" variant="secondary" onPress={() => void copyPayload()}>
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? 'Copied' : 'Copy link'}
            </Button>
          </div>
        </div>
      ) : (
        <p className="management-hint">Waiting for QR code payload from integration...</p>
      )}
    </div>
  );
}
