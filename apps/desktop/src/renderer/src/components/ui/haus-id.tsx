/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';

/** Renders a non-interactive monospace Haus ID badge safe for embedding inside buttons. */
export function HausIdCode({ value, className }: { value: string; className?: string }) {
  return (
    <code className={className ? `haus-id-code ${className}` : 'haus-id-code'} title={value}>
      {value}
    </code>
  );
}

/** Renders a Haus-style identifier alongside a one-click copy action. */
export function HausIdValue({
  value,
  label = 'Haus ID',
  className,
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    try {
      await navigator.clipboard?.writeText(value);
      setCopied(true);
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard API unavailable in restricted/non-DOM environments.
    }
  };

  return (
    <span className={className ? `haus-id-value ${className}` : 'haus-id-value'}>
      <HausIdCode value={value} />
      <button
        type="button"
        className="haus-id-copy"
        data-copied={copied ? 'true' : undefined}
        onClick={(e) => void handleCopy(e)}
        aria-label={copied ? `Copied ${label}` : `Copy ${label} ${value}`}
        title={copied ? 'Copied' : `Copy ${label}`}
      >
        {copied ? <Check size={11} /> : <Copy size={11} />}
      </button>
    </span>
  );
}

/** Displays canonical Haus device/entity identifiers inside device settings and edit dialogs. */
export function HausIdProperties({
  deviceHausId,
  entityHausId,
  backendDeviceId,
  entityId,
  className,
}: {
  deviceHausId: string;
  entityHausId?: string;
  backendDeviceId?: string;
  entityId?: string;
  className?: string;
}) {
  return (
    <dl className={className ? `haus-id-details ${className}` : 'haus-id-details'}>
      <div>
        <dt>Haus ID</dt>
        <dd>
          <HausIdValue value={deviceHausId} label="Haus device ID" />
        </dd>
      </div>
      {entityHausId && (
        <div>
          <dt>Entity Haus ID</dt>
          <dd>
            <HausIdValue value={entityHausId} label="Haus entity ID" />
          </dd>
        </div>
      )}
      {backendDeviceId && (
        <div>
          <dt>Device ID</dt>
          <dd>
            <HausIdCode value={backendDeviceId} />
          </dd>
        </div>
      )}
      {entityId && (
        <div>
          <dt>Entity ID</dt>
          <dd>
            <HausIdCode value={entityId} />
          </dd>
        </div>
      )}
    </dl>
  );
}
