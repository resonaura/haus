/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useState } from 'react';
import { Box, HausButton, HausLabel, Heading, Text, TextInput } from '@haus/ui';
import { HapticSlider as Slider } from '../../components/ui/HapticSlider';
import { Check, Infinity as InfinityIcon, HardDrive } from 'lucide-react';
import { allocatedSpace, bytes, GIB, quotaRange } from './presentation';
import type { HomeServer } from './types';

export function StorageLimit({
  server,
  admin,
  busy,
  onSave,
}: {
  server: HomeServer;
  admin: boolean;
  busy: boolean;
  onSave: (limit: number | null) => Promise<void>;
}) {
  const saved = server.settings?.storageLimitBytes ?? null;
  const localCache =
    server.kind === 'home-assistant' && server.storage?.cachePolicy === 'verified-archive';
  const [draft, setDraft] = useState<number | null | undefined>();
  const [savedFeedback, setSavedFeedback] = useState(false);
  const current = draft === undefined ? saved : draft;
  const max = quotaRange(server);
  const changed = current !== saved;
  const save = () =>
    onSave(current)
      .then(() => {
        setDraft(undefined);
        setSavedFeedback(true);
      })
      .catch(() => {});
  const update = (value: number | null) => {
    setDraft(value);
    setSavedFeedback(false);
  };
  return (
    <Box semantic="section" className="server-panel server-storage-limit">
      <Box className="server-section-heading">
        <Box>
          <Heading level={3}>
            {localCache ? 'Recent video on this Hub' : 'NVR storage budget'}
          </Heading>
          <Text semantic="p">
            {localCache
              ? 'Keep recent recordings here; older footage stays on your NVR servers.'
              : server.kind === 'home-assistant' || server.kind === 'hub'
                ? 'Set a budget for original camera recordings.'
                : 'Set a budget for NVR media and encrypted recovery copies. Other services and files are not limited.'}
          </Text>
        </Box>
        <Text>{current === null ? 'Unlimited' : bytes(current)}</Text>
      </Box>
      <Box className="server-limit-modes" ariaLabel="NVR storage limit">
        <HausButton
          variant={current === null ? 'secondary' : 'ghost'}
          aria-pressed={current === null}
          isDisabled={!admin || busy || !server.online}
          onPress={() => update(null)}
        >
          <InfinityIcon size={19} />
          Unlimited
        </HausButton>
        <HausButton
          variant={current !== null ? 'secondary' : 'ghost'}
          aria-pressed={current !== null}
          isDisabled={!admin || busy || !server.online}
          onPress={() => {
            if (current === null) update(Math.min(max, Math.max(1, Math.round(max / 2))) * GIB);
          }}
        >
          <HardDrive size={17} />
          Set a limit
        </HausButton>
      </Box>
      {server.storage && (
        <Box className="server-limit-usage">
          <Text>
            {bytes(server.storage.usedBytes)} {localCache ? 'on this Hub' : 'saved'}
          </Text>
          <Text>
            {allocatedSpace(server) !== undefined
              ? allocatedSpace(server) === null
                ? 'Available space is not reported'
                : `${bytes(allocatedSpace(server))} available for Haus`
              : `${bytes(server.storage.freeBytes)} free on disk`}
          </Text>
        </Box>
      )}
      {localCache && server.storage?.archivedBytes !== undefined && (
        <Text semantic="p" className="server-muted">
          {bytes(server.storage.archivedBytes)} archived on NVR · 10 GB local cache by default
        </Text>
      )}
      {current !== null && (
        <Box className="server-limit-adjust">
          <Slider
            aria-label="Storage budget in gigabytes"
            minValue={1}
            maxValue={max}
            step={1}
            value={current / GIB}
            isDisabled={!admin || busy || !server.online}
            onChange={(value) => {
              if (typeof value === 'number') update(value * GIB);
            }}
          >
            <HausLabel>Storage budget</HausLabel>
            <Slider.Output>{bytes(current)}</Slider.Output>
            <Slider.Track>
              <Slider.Fill />
              <Slider.Thumb />
            </Slider.Track>
          </Slider>
          <Text semantic="label" className="server-limit-number">
            <TextInput
              ariaLabel="Exact storage budget in gigabytes"
              inputType="number"
              min={1}
              max={max}
              step={1}
              value={String(Math.round(current / GIB))}
              disabled={!admin || busy || !server.online}
              onChange={(raw) => {
                const value = Number(raw);
                if (Number.isFinite(value) && value >= 1) update(Math.min(max, value) * GIB);
              }}
            />
            <Text>GB</Text>
          </Text>
        </Box>
      )}
      <Box className="server-limit-footer">
        <Text semantic="p">
          {current === null
            ? 'No fixed cap. Haus keeps a reserve of free disk space. Recording retention still applies.'
            : localCache
              ? 'Older local files are released after their NVR archive is verified. Your timeline stays available. Without a verified archive, recording pauses safely.'
              : server.kind === 'home-assistant'
                ? 'Existing recordings and backups stay. New recordings pause at this limit; normal recording retention still applies.'
                : 'Existing files stay. New copies pause until usage falls below this limit.'}
        </Text>
        {admin && (
          <HausButton
            variant={changed ? 'primary' : 'ghost'}
            isPending={busy}
            isDisabled={busy || !changed || !server.online}
            onPress={() => {
              void save();
            }}
          >
            {savedFeedback && !changed ? (
              <>
                <Check size={16} />
                Saved
              </>
            ) : (
              'Save limit'
            )}
          </HausButton>
        )}
      </Box>
    </Box>
  );
}
