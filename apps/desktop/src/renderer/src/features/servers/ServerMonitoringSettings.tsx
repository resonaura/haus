/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useState } from 'react';
import { Box, HausButton, Heading, Text } from '@haus/ui';
import { Activity, Unplug } from 'lucide-react';
import { Dialog } from '../../components/ui/Dialog';
import { serverRequest } from './server-api';
import { serverHasNvr, serverManagementId } from './server-connections';
import type { HomeServer } from './types';

export function ServerMonitoringSettings({
  server,
  supported,
  fresh,
  busy,
  onConnect,
  onChanged,
}: {
  server: HomeServer;
  supported: boolean;
  fresh: boolean;
  busy: boolean;
  onConnect: () => void;
  onChanged: () => Promise<void>;
}) {
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState(false);
  const [removedId, setRemovedId] = useState<string>();
  const [error, setError] = useState('');
  const connected = Boolean(server.managedId);
  const disconnect = async () => {
    setPending(true);
    setError('');
    try {
      if (removedId !== serverManagementId(server)) {
        await serverRequest('POST', `/api/cluster/nodes/${serverManagementId(server)}/remove`, {});
        setRemovedId(serverManagementId(server));
      }
      await onChanged();
      setConfirm(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Monitoring could not be disconnected.');
    } finally {
      setPending(false);
    }
  };
  return (
    <>
      <Box semantic="section" className="server-panel server-management-actions">
        <Box className="server-section-heading">
          <Box>
            <Heading level={3}>
              <Activity size={19} />
              System Monitoring
            </Heading>
            <Text semantic="p">
              {connected
                ? serverHasNvr(server)
                  ? 'Haus Hub reports system information and provides the camera services assigned to this machine.'
                  : 'Haus Hub reports this machine’s resources, disks and services. No camera or backup work is assigned.'
                : supported
                  ? 'Add resource, disk and service information to this SSH connection with an optional Haus Hub.'
                  : 'Update Haus Hub to connect system monitoring for this SSH server.'}
            </Text>
          </Box>
        </Box>
        {!connected && (
          <HausButton
            variant="secondary"
            isDisabled={busy || !fresh || !supported}
            onPress={onConnect}
          >
            <Activity size={16} />
            Connect monitoring
          </HausButton>
        )}
        {connected && !serverHasNvr(server) && (
          <HausButton variant="ghost" isDisabled={busy || !fresh} onPress={() => setConfirm(true)}>
            <Unplug size={16} />
            Disconnect monitoring
          </HausButton>
        )}
      </Box>
      {confirm && (
        <Dialog
          title="Disconnect system monitoring?"
          onClose={() => {
            if (!pending) setConfirm(false);
          }}
        >
          <Text semantic="p" className="registry-help">
            Your SSH connection and saved credentials stay available. Haus stops collecting this
            server’s metrics; the server’s own services keep running.
          </Text>
          {error && (
            <Text semantic="p" className="form-error" role="alert">
              {error}
            </Text>
          )}
          <Box className="registry-dialog-actions">
            <HausButton variant="ghost" isDisabled={pending} onPress={() => setConfirm(false)}>
              Keep connected
            </HausButton>
            <HausButton variant="danger" isPending={pending} onPress={() => void disconnect()}>
              Disconnect monitoring
            </HausButton>
          </Box>
        </Dialog>
      )}
    </>
  );
}
