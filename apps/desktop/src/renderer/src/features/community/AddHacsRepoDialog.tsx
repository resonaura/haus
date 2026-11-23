/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useState } from 'react';
import { Button } from '@heroui/react';
import { Dialog } from '../../components/ui/Dialog';
import {
  communityRepositoryName,
  formatHacsRepositoryError,
  hacs,
  type CommunityRepository,
} from './hacs';

const DEFAULT_CATEGORIES = ['integration', 'plugin', 'theme', 'template'] as const;

export function AddHacsRepoDialog({
  categories = DEFAULT_CATEGORIES,
  defaultCategory = 'integration',
  onClose,
  onAdded,
}: {
  categories?: readonly string[];
  defaultCategory?: string;
  onClose: () => void;
  onAdded: (repo: CommunityRepository) => void | Promise<void>;
}) {
  const [source, setSource] = useState('');
  const [category, setCategory] = useState(defaultCategory);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const repository = communityRepositoryName(source);
      const added = await hacs<CommunityRepository>('repositories/add', {
        repository,
        category,
      });
      await onAdded(added);
      onClose();
    } catch (reason) {
      setError(formatHacsRepositoryError(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Add custom HACS repository"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p className="flow-description">
        Add any custom Home Assistant Community Store (HACS) GitHub repository. Haus validates{' '}
        <code>hacs.json</code> and <code>custom_components/&lt;domain&gt;/manifest.json</code>{' '}
        automatically, just like HACS in Home Assistant.
      </p>
      <form id="hacs-add-source" onSubmit={(e) => void handleSubmit(e)}>
        <label className="management-field">
          <span>GitHub repository URL or owner/name</span>
          <input
            value={source}
            required
            disabled={busy}
            placeholder="https://github.com/owner/repository"
            onChange={(event) => setSource(event.target.value)}
          />
        </label>
        <label className="management-field">
          <span>Category</span>
          <select
            value={category}
            disabled={busy}
            onChange={(event) => setCategory(event.target.value)}
          >
            {categories.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <div className="management-action-row">
          <Button type="button" variant="ghost" isDisabled={busy} onPress={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" isPending={busy} isDisabled={busy}>
            Add repository
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
