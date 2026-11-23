/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { ReactNode } from 'react';
import { Box, Heading, Text } from '@haus/ui';
import { Video } from 'lucide-react';
import { StorageLimit } from './StorageLimit';
import type { HomeServer } from './types';
import { HausStorageUsage } from './HausStorageUsage';
import { LivePriority } from './LivePriority';
import { serverIsLocalHub } from './server-connections';

export function ServerNvr({
  server,
  fresh,
  admin,
  busy,
  onSaveLimit,
  backups,
}: {
  server: HomeServer;
  fresh: boolean;
  admin: boolean;
  busy: boolean;
  onSaveLimit: (limit: number | null) => Promise<void>;
  backups?: ReactNode;
}) {
  const live = fresh && server.online === true && server.enabled !== false;
  const storage = server.roles?.includes('storage');
  const streaming = server.roles?.includes('stream');
  return (
    <>
      <Box semantic="section" className="server-panel server-nvr-capabilities">
        <Box className="server-section-heading">
          <Box>
            <Heading level={3}>
              <Video size={19} />
              Haus NVR
            </Heading>
            <Text semantic="p">
              Camera recording, streaming and recovery copies are separate from this server’s system
              information.
            </Text>
          </Box>
        </Box>
        <Box className="server-nvr-role-grid">
          <Box>
            <Text semantic="strong">Recording storage</Text>
            <Text>{storage ? 'Assigned' : server.roles ? 'Not assigned' : 'Not reported'}</Text>
            <Text semantic="p">
              Store camera recordings and encrypted recovery copies for this home.
            </Text>
          </Box>
          <Box>
            <Text semantic="strong">Video streaming</Text>
            <Text>{streaming ? 'Assigned' : server.roles ? 'Not assigned' : 'Not reported'}</Text>
            <Text semantic="p">Relay camera video and help prepare recordings for playback.</Text>
          </Box>
        </Box>
        <Box className="server-work" ariaLabel="NVR work on this server">
          {server.streams && streaming && (
            <Text>
              <Text semantic="strong">
                {live ? `${server.streams.active} / ${server.streams.max}` : '—'}
              </Text>
              Active streams
            </Text>
          )}
          {server.playback && streaming && (
            <Text>
              <Text semantic="strong">
                {live ? `${server.playback.active} / ${server.playback.max}` : '—'}
              </Text>
              Playback preparation
            </Text>
          )}
          {server.analysis && streaming && (
            <Text>
              <Text semantic="strong">
                {live ? `${server.analysis.active} / ${server.analysis.max}` : '—'}
              </Text>
              Activity assist
            </Text>
          )}
          {server.backupCopies !== undefined && (
            <Text>
              <Text semantic="strong">{server.backupCopies}</Text>
              {fresh ? 'Recovery copies on this server' : 'Last known recovery copies'}
            </Text>
          )}
        </Box>
        {streaming && !serverIsLocalHub(server) && (
          <LivePriority
            key={server.managedId ?? server.id}
            server={server}
            disabled={!admin || busy}
          />
        )}
        <Text semantic="p" className="server-muted">
          NVR roles are chosen when this server is paired. Activity assist uses compatible streaming
          servers when enabled for a camera.
        </Text>
      </Box>
      {server.settings && (
        <StorageLimit server={server} admin={admin} busy={busy || !live} onSave={onSaveLimit} />
      )}
      <HausStorageUsage usage={server.storage?.usage} online={live} />
      {backups}
    </>
  );
}
