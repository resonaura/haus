/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useState } from 'react';
import type { AddonRepositorySummary } from '@haus/core/transport';
import { colorToken, corners, insets, pct, px } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import {
  Box,
  HausButton,
  HausDialog,
  Heading,
  Row,
  ScrollView,
  Stack,
  Text,
  TextInput,
  useHausUi,
} from '../../primitives/index.js';
import { UiIcon } from '../icon.js';

export function AppRepositoriesModal({
  repositories,
  canManage,
  loading,
  busy,
  error,
  notice,
  onAdd,
  onReloadAll,
  onReload,
  onRemove,
  onOpenExternal,
  onClose,
}: {
  readonly repositories: readonly AddonRepositorySummary[];
  readonly canManage: boolean;
  readonly loading: boolean;
  readonly busy: boolean;
  readonly error?: string;
  readonly notice?: string;
  readonly onAdd: (url: string) => void;
  readonly onReloadAll: () => void;
  readonly onReload: (id: string) => void;
  readonly onRemove: (repo: AddonRepositorySummary) => void;
  readonly onOpenExternal?: (url: string) => void;
  readonly onClose: () => void;
}) {
  const { theme } = useHausUi();
  const primaryFg = theme.mode === 'dark' ? '#101010' : '#ffffff';
  const [url, setUrl] = useState('');

  const submitAdd = () => {
    const trimmed = url.trim();
    if (!trimmed || busy) return;
    onAdd(trimmed);
    setUrl('');
  };

  return (
    <HausDialog
      size="md"
      title="Add-on Repositories"
      subtitle="Add Home Assistant Supervisor-compatible GitHub add-on repositories (repository.yaml / config.yaml)."
      scrollable
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <Row justify="end" style={{ layout: { width: pct(100) } }}>
          <HausButton id="app-repos-done" variant="secondary" disabled={busy} onPress={onClose}>
            Done
          </HausButton>
        </Row>
      }
    >
      <Stack gapPx={14} style={{ layout: { width: pct(100) } }}>
        {error && (
          <Text size={12} tone="critical" role="alert">
            {error}
          </Text>
        )}
        {notice && (
          <Text size={12} tone="accent" role="status">
            {notice}
          </Text>
        )}

        {canManage && (
          <Row align="end" gapPx={8} wrap style={{ layout: { width: pct(100) } }}>
            <Stack gapPx={4} style={{ layout: { flexGrow: 1, minWidth: px(200) } }}>
              <Text size={12} weight={600}>
                Repository URL
              </Text>
              <TextInput
                id="app-repos-url-input"
                ariaLabel="Repository URL"
                placeholder="https://github.com/owner/addon-repository"
                value={url}
                disabled={busy}
                onChange={setUrl}
                onSubmit={submitAdd}
                style={{
                  layout: { width: pct(100), height: px(36), padding: insets(0, 12) },
                  material: new SolidMaterial(colorToken('surfaceSecondary')),
                  border: { width: 1, color: colorToken('border') },
                  corners: corners(10),
                  typography: { size: 13, color: colorToken('textPrimary') },
                }}
              />
            </Stack>
            <HausButton
              id="app-repos-add"
              variant="primary"
              size="sm"
              disabled={busy || !url.trim()}
              onPress={submitAdd}
            >
              <UiIcon name="plus" size={14} color={primaryFg} />
              <Text
                size={12.5}
                style={{ typography: { color: colorToken('accentForeground'), weight: 600 } }}
              >
                Add
              </Text>
            </HausButton>
          </Row>
        )}

        <Row align="center" justify="between" gapPx={10} style={{ layout: { width: pct(100) } }}>
          <Text size={12.5} weight={600}>
            {`Custom repositories (${repositories.length})`}
          </Text>
          {canManage && repositories.length > 0 && (
            <HausButton
              id="app-repos-reload-all"
              variant="ghost"
              size="sm"
              disabled={busy || loading}
              onPress={onReloadAll}
            >
              <UiIcon name="refresh-cw" size={13} />
              <Text size={12}>Reload all</Text>
            </HausButton>
          )}
        </Row>

        {loading && (
          <Text size={12.5} tone="muted">
            Loading custom repositories…
          </Text>
        )}

        {!loading && repositories.length === 0 && (
          <Text size={12.5} tone="muted">
            No custom add-on repositories added yet. Paste a GitHub URL above to add one.
          </Text>
        )}

        {repositories.length > 0 && (
          <ScrollView
            orientation="vertical"
            style={{ layout: { width: pct(100), maxHeight: px(280) } }}
          >
            <Stack gapPx={10} style={{ layout: { width: pct(100) } }}>
              {repositories.map((repo) => (
                <Row
                  key={repo.id}
                  id={`app-repo-row-${repo.id}`}
                  align="center"
                  justify="between"
                  gapPx={12}
                  wrap
                  style={{
                    layout: { width: pct(100), padding: insets(12, 14) },
                    material: new SolidMaterial(colorToken('surfaceSecondary')),
                    border: { width: 1, color: colorToken('border') },
                    corners: corners(12),
                  }}
                >
                  <Row
                    align="center"
                    gapPx={10}
                    style={{ layout: { flexGrow: 1, minWidth: px(200) } }}
                  >
                    <Box
                      style={{
                        layout: {
                          width: px(34),
                          height: px(34),
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        },
                        material: new SolidMaterial(colorToken('surface')),
                        border: { width: 1, color: colorToken('border') },
                        corners: corners(9),
                      }}
                    >
                      <UiIcon name="folder-git-2" size={16} />
                    </Box>
                    <Stack gapPx={2} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
                      <Row align="center" gapPx={6} wrap>
                        <Heading level={4} size={13.5} weight={600}>
                          {repo.name}
                        </Heading>
                        <Text size={11} tone="muted">
                          {`${repo.addonIds.length} ${repo.addonIds.length === 1 ? 'add-on' : 'add-ons'}`}
                        </Text>
                        {repo.branch && (
                          <Text size={11} tone="accent">
                            {`#${repo.branch}`}
                          </Text>
                        )}
                      </Row>
                      <Text size={11.5} tone="muted">
                        {repo.url}
                      </Text>
                      {repo.maintainer && (
                        <Text size={11} tone="muted">
                          {`Maintainer: ${repo.maintainer}`}
                        </Text>
                      )}
                    </Stack>
                  </Row>
                  <Row align="center" gapPx={6}>
                    {onOpenExternal && (
                      <HausButton
                        id={`app-repo-open-${repo.id}`}
                        variant="ghost"
                        size="sm"
                        aria-label={`Open ${repo.name}`}
                        onPress={() => onOpenExternal(repo.infoUrl || repo.url.replace(/#.*$/, ''))}
                      >
                        <UiIcon name="external-link" size={13} />
                      </HausButton>
                    )}
                    {canManage && (
                      <>
                        <HausButton
                          id={`app-repo-reload-${repo.id}`}
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          aria-label={`Reload ${repo.name}`}
                          onPress={() => onReload(repo.id)}
                        >
                          <UiIcon name="refresh-cw" size={13} />
                        </HausButton>
                        <HausButton
                          id={`app-repo-remove-${repo.id}`}
                          variant="danger-soft"
                          size="sm"
                          disabled={busy}
                          aria-label={`Remove ${repo.name}`}
                          onPress={() => onRemove(repo)}
                        >
                          <UiIcon name="trash-2" size={13} />
                        </HausButton>
                      </>
                    )}
                  </Row>
                </Row>
              ))}
            </Stack>
          </ScrollView>
        )}
      </Stack>
    </HausDialog>
  );
}
