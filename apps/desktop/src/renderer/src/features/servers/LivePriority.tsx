/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */
import { useState } from 'react';
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
    <div className="server-nvr-priority">
      <label>
        Live Media Priority{' '}
        <select
          value={value}
          disabled={disabled || pending}
          onChange={(event) => void save(Number(event.target.value))}
        >
          <option value={0}>Automatic</option>
          <option value={25}>Low</option>
          <option value={50}>Preferred</option>
          <option value={100}>Highest</option>
        </select>
      </label>
      <p className="server-muted">
        Haus and Apple Home prefer this worker for new Live sessions while it is online and has
        capacity. Existing streams stay uninterrupted. A warm source can be relayed from another
        node.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
