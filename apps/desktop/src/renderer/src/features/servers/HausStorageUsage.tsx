/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Box, HausDisclosure, HausProgressBar, Heading, Text } from '@haus/ui';
import {
  Archive,
  Database,
  FileVideo,
  Files,
  HardDrive,
  Image,
  Layers,
  Radio,
  Settings,
  Timer,
  Video,
} from 'lucide-react';
import { bytes } from './presentation';
import type { HausStorageUsage as Usage } from './types';

const categories = {
  originals: ['Original Recordings', Video],
  prepared: ['Prepared Playback', FileVideo],
  prebuffer: ['Pre-event Buffer', Timer],
  snapshots: ['Snapshots & Thumbnails', Image],
  'ha-backups': ['Home Assistant Backups', Archive],
  'config-backups': ['Configuration Backups', Archive],
  databases: ['Databases', Database],
  logs: ['Logs', Files],
  configuration: ['Configuration', Settings],
  capture: ['Capture in Progress', Video],
  preparation: ['Playback Preparation', FileVideo],
  'stream-cache': ['Stream Cache', Radio],
  temporary: ['Temporary Files', Timer],
  'other-media': ['Unclassified Media', FileVideo],
  shared: ['Shared Files', Layers],
  other: ['Other Haus Files', Files],
} as const;

export function HausStorageUsage({
  usage,
  online,
}: {
  usage: Usage | null | undefined;
  online: boolean;
}) {
  const rows =
    usage?.categories
      .filter((row) => Number.isSafeInteger(row.logicalBytes) && row.logicalBytes >= 0)
      .sort((a, b) => b.logicalBytes - a.logicalBytes) ?? [];
  const stale = Boolean(usage) && (!online || Date.now() - usage!.sampledAt > 90000);
  const measuring = online && usage === null;
  return (
    <Box semantic="section" className="server-panel server-haus-storage" ariaLabel="Haus Storage">
      <Box className="server-section-heading">
        <Heading level={3}>
          <HardDrive size={18} />
          Haus Storage
        </Heading>
        {usage && (
          <Text>
            {!usage.complete && '≥ '}
            {bytes(usage.logicalBytes)}
          </Text>
        )}
      </Box>
      {!usage ? (
        <>
          <Text semantic="p" className="server-muted">
            {measuring
              ? 'Measuring files managed by Haus…'
              : 'This server has not reported storage measurements yet.'}
          </Text>
          {measuring && <HausProgressBar ariaLabel="Measuring Haus storage" indeterminate />}
        </>
      ) : (
        <>
          {Boolean(usage.logicalBytes) && (
            <Box
              className="server-haus-storage-bar"
              role="group"
              ariaLabel="Haus file size by component"
            >
              {rows.map((row, index) => (
                <Text
                  key={row.id}
                  style={{
                    layout: { flexGrow: row.logicalBytes },
                    opacity: 0.3 + (index % 5) * 0.14,
                  }}
                  title={`${(categories[row.id as keyof typeof categories] ?? categories.other)[0]}: ${bytes(row.logicalBytes)}`}
                />
              ))}
            </Box>
          )}
          <Box className="server-haus-storage-head" ariaHidden>
            <Text>Component</Text>
            <Text>File Size</Text>
            <Text>Allocated</Text>
          </Box>
          <Box semantic="dl" className="server-haus-storage-list">
            {rows.map((row) => {
              const [label, Icon] =
                categories[row.id as keyof typeof categories] ?? categories.other;
              return (
                <Box key={row.id}>
                  <Box semantic="dt">
                    <Icon size={16} />
                    <Text>{label}</Text>
                  </Box>
                  <Box semantic="dd">{bytes(row.logicalBytes)}</Box>
                  <Box semantic="dd">{bytes(row.allocatedBytes)}</Box>
                </Box>
              );
            })}
            <Box className="server-haus-storage-total">
              <Box semantic="dt">
                Total{stale ? ' · Last Known' : !usage.complete ? ' · Partial' : ''}
              </Box>
              <Box semantic="dd">
                {!usage.complete && '≥ '}
                {bytes(usage.logicalBytes)}
              </Box>
              <Box semantic="dd">
                {!usage.complete && usage.allocatedBytes !== null && '≥ '}
                {bytes(usage.allocatedBytes)}
              </Box>
            </Box>
          </Box>
          {!usage.complete && (
            <Text semantic="p" className="server-muted" role="status">
              Some files could not be measured. These totals show at least the reported amount.
            </Text>
          )}
          {rows.some((row) => row.id === 'other-media') && (
            <Text semantic="p" className="server-muted">
              Unclassified media has no confirmed recording variant yet. Classification is updated
              from the recording catalog.
            </Text>
          )}
          <Text semantic="small" className="server-muted">
            {stale ? 'Last measured' : 'Measured'} {new Date(usage.sampledAt).toLocaleTimeString()}{' '}
            · Updates in the background
          </Text>
          <HausDisclosure className="server-haus-storage-about" summary="About these measurements">
            <Text className="server-muted" tone="muted" size={12}>
              Across this server’s Haus storage locations, separate from total disk usage.
              Hard-linked files count once; files used by multiple components appear as Shared
              Files. Allocated blocks can share physical storage through compression or snapshots.
              Container images and external service logs are outside these totals.
            </Text>
          </HausDisclosure>
        </>
      )}
    </Box>
  );
}
