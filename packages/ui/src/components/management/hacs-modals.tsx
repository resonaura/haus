/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useState } from 'react';
import { DEFAULT_HACS_CATEGORIES } from '@haus/core/transport';
import { pct } from '../../ir/geometry.js';
import {
  HausButton,
  HausDialog,
  Row,
  SelectInput,
  Stack,
  Text,
  TextInput,
} from '../../primitives/index.js';

export interface HacsConfirmation {
  readonly title: string;
  readonly label: string;
  readonly description: string;
  readonly danger?: boolean;
  readonly action: () => Promise<unknown>;
}

export function HacsConfirmDialog({
  confirmation,
  busy,
  onClose,
  onConfirm,
}: {
  readonly confirmation: HacsConfirmation;
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
}) {
  return (
    <HausDialog
      title={confirmation.title}
      size="sm"
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <Row justify="end" gapPx={8} style={{ layout: { width: pct(100) } }}>
          <HausButton
            id="hacs-confirm-cancel"
            variant="ghost"
            size="sm"
            disabled={busy}
            onPress={onClose}
          >
            Cancel
          </HausButton>
          <HausButton
            id="hacs-confirm-submit"
            variant={confirmation.danger ? 'danger' : 'primary'}
            size="sm"
            disabled={busy}
            onPress={onConfirm}
          >
            {confirmation.label}
          </HausButton>
        </Row>
      }
    >
      <Text size={13} tone="secondary">
        {confirmation.description}
      </Text>
    </HausDialog>
  );
}

export function AddHacsRepositoryModal({
  categories = DEFAULT_HACS_CATEGORIES,
  defaultCategory = 'integration',
  busy = false,
  error,
  onClose,
  onSubmit,
}: {
  readonly categories?: readonly string[];
  readonly defaultCategory?: string;
  readonly busy?: boolean;
  readonly error?: string;
  readonly onClose: () => void;
  readonly onSubmit: (source: string, category: string) => void;
}) {
  const [source, setSource] = useState('');
  const [category, setCategory] = useState(
    categories.includes(defaultCategory) ? defaultCategory : (categories[0] ?? 'integration'),
  );

  return (
    <HausDialog
      title="Add custom HACS repository"
      size="md"
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <Row justify="end" gapPx={8} style={{ layout: { width: pct(100) } }}>
          <HausButton
            id="hacs-add-repo-cancel"
            variant="ghost"
            size="sm"
            disabled={busy}
            onPress={onClose}
          >
            Cancel
          </HausButton>
          <HausButton
            id="hacs-add-repo-submit"
            variant="primary"
            size="sm"
            disabled={busy || !source.trim()}
            onPress={() => onSubmit(source, category)}
          >
            Add repository
          </HausButton>
        </Row>
      }
    >
      <Stack gapPx={12} style={{ layout: { width: pct(100) } }}>
        <Text size={12.5} tone="muted">
          Add any custom Home Assistant Community Store (HACS) GitHub repository. Haus validates
          hacs.json and custom_components/&lt;domain&gt;/manifest.json automatically.
        </Text>
        <Stack gapPx={4}>
          <Text size={12} weight={600}>
            GitHub repository URL or owner/name
          </Text>
          <TextInput
            id="hacs-add-repo-url"
            ariaLabel="GitHub repository URL or owner/name"
            placeholder="https://github.com/owner/repository"
            value={source}
            disabled={busy}
            onChange={setSource}
            onSubmit={() => {
              if (!busy && source.trim()) onSubmit(source, category);
            }}
          />
        </Stack>
        <Stack gapPx={4}>
          <Text size={12} weight={600}>
            Category
          </Text>
          <SelectInput
            id="hacs-add-repo-category"
            ariaLabel="Repository category"
            value={category}
            disabled={busy}
            options={categories.map((value) => ({ value, label: value }))}
            onChange={setCategory}
          />
        </Stack>
        {error && (
          <Text size={12} tone="critical">
            {error}
          </Text>
        )}
      </Stack>
    </HausDialog>
  );
}
