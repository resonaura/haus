/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useRef, useState } from 'react';
import { Box, HausCode, Pressable, Text } from '@haus/ui';
import { Check, Copy } from 'lucide-react';

/** Renders a non-interactive monospace Haus ID badge safe for embedding inside buttons. */
export function HausIdCode({ value, className }: { value: string; className?: string }) {
  return (
    <HausCode className={className ? `haus-id-code ${className}` : 'haus-id-code'} title={value}>
      {value}
    </HausCode>
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

  const handleCopy = async () => {
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
    <Text className={className ? `haus-id-value ${className}` : 'haus-id-value'}>
      <HausIdCode value={value} />
      <Pressable
        type="button"
        className="haus-id-copy"
        stopPropagation
        dataAttrs={{ 'data-copied': copied ? 'true' : undefined }}
        onPress={() => void handleCopy()}
        ariaLabel={copied ? `Copied ${label}` : `Copy ${label} ${value}`}
        title={copied ? 'Copied' : `Copy ${label}`}
      >
        {copied ? <Check size={11} /> : <Copy size={11} />}
      </Pressable>
    </Text>
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
    <Box semantic="dl" className={className ? `haus-id-details ${className}` : 'haus-id-details'}>
      <Box>
        <Box semantic="dt">Haus ID</Box>
        <Box semantic="dd">
          <HausIdValue value={deviceHausId} label="Haus device ID" />
        </Box>
      </Box>
      {entityHausId && (
        <Box>
          <Box semantic="dt">Entity Haus ID</Box>
          <Box semantic="dd">
            <HausIdValue value={entityHausId} label="Haus entity ID" />
          </Box>
        </Box>
      )}
      {backendDeviceId && (
        <Box>
          <Box semantic="dt">Device ID</Box>
          <Box semantic="dd">
            <HausIdCode value={backendDeviceId} />
          </Box>
        </Box>
      )}
      {entityId && (
        <Box>
          <Box semantic="dt">Entity ID</Box>
          <Box semantic="dd">
            <HausIdCode value={entityId} />
          </Box>
        </Box>
      )}
    </Box>
  );
}
