/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useState } from 'react';
import { Box, HausButton, HausCode, HausForm, SelectInput, Text, TextInput } from '@haus/ui';
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

  const handleSubmit = async () => {
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
      <Text semantic="p" className="flow-description">
        Add any custom Home Assistant Community Store (HACS) GitHub repository. Haus validates{' '}
        <HausCode>hacs.json</HausCode> and{' '}
        <HausCode>custom_components/&lt;domain&gt;/manifest.json</HausCode> automatically, just like
        HACS in Home Assistant.
      </Text>
      <HausForm id="hacs-add-source" onSubmit={() => void handleSubmit()}>
        <Text semantic="label" className="management-field">
          <Text>GitHub repository URL or owner/name</Text>
          <TextInput
            value={source}
            required
            disabled={busy}
            placeholder="https://github.com/owner/repository"
            onChange={setSource}
          />
        </Text>
        <Text semantic="label" className="management-field">
          <Text>Category</Text>
          <SelectInput
            value={category}
            disabled={busy}
            options={categories.map((value) => ({ value, label: value }))}
            onChange={setCategory}
          />
        </Text>
        {error && (
          <Text semantic="p" role="alert" className="form-error">
            {error}
          </Text>
        )}
        <Box className="management-action-row">
          <HausButton type="button" variant="ghost" isDisabled={busy} onPress={onClose}>
            Cancel
          </HausButton>
          <HausButton type="submit" variant="primary" isPending={busy} isDisabled={busy}>
            Add repository
          </HausButton>
        </Box>
      </HausForm>
    </Dialog>
  );
}
