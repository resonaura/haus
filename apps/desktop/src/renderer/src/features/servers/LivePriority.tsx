/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */
import { useState } from 'react';
import { Box, SelectInput, Text } from '@haus/ui';
import { serverRequest } from './server-api';
import { serverManagementId } from './server-connections';
import type { HomeServer } from './types';
export function LivePriority({ server, disabled }: { server: HomeServer; disabled: boolean }) {
  const [value, setValue] = useState(server.livePriority ?? 0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const save = async (priority: number) => {
    const before = value;
    setValue(priority);
    setPending(true);
    setError('');
    try {
      await serverRequest('PATCH', `/api/cluster/nodes/${serverManagementId(server)}`, {
        livePriority: priority,
      });
    } catch (reason) {
      setValue(before);
      setError(reason instanceof Error ? reason.message : 'Priority could not be saved.');
    } finally {
      setPending(false);
    }
  };
  return (
    <Box className="server-nvr-priority">
      <Text semantic="label">
        Live Media Priority{' '}
        <SelectInput
          value={String(value)}
          disabled={disabled || pending}
          options={[
            { value: '0', label: 'Automatic' },
            { value: '25', label: 'Low' },
            { value: '50', label: 'Preferred' },
            { value: '100', label: 'Highest' },
          ]}
          onChange={(next) => void save(Number(next))}
        />
      </Text>
      <Text semantic="p" className="server-muted">
        Haus and Apple Home prefer this worker for new Live sessions while it is online and has
        capacity. Existing streams stay uninterrupted. A warm source can be relayed from another
        node.
      </Text>
      {error && (
        <Text semantic="p" className="form-error" role="alert">
          {error}
        </Text>
      )}
    </Box>
  );
}
