/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useState, type ReactNode } from 'react';
import {
  buildHacsVersionOptions,
  type CommunityRepository,
  type HacsReleaseNote,
  type HacsReleaseTag,
} from '@haus/core/transport';
import { colorToken, corners, insets, pct, px } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import {
  Box,
  HausButton,
  HausSwitch,
  Heading,
  Pressable,
  Row,
  SelectInput,
  Stack,
  Text,
} from '../../primitives/index.js';
import { UiIcon } from '../icon.js';

function isSafeExternalHttps(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

function PortableMarkdown({
  text,
  onOpenLink,
}: {
  readonly text: string;
  readonly onOpenLink?: (url: string) => void;
}) {
  const references = new Map<string, string>();
  const lines = text.split('\n').filter((line) => {
    const reference = line.match(/^\s*\[([^\]]+)\]:\s*(\S+)/);
    if (reference?.[1] && reference[2]) {
      references.set(reference[1].toLowerCase(), reference[2]);
      return false;
    }
    return !/^\s*!\[/.test(line);
  });

  const inlineParts = (value: string): ReactNode =>
    value
      .split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|\[[^\]]+\]\[[^\]]+\])/g)
      .filter(Boolean)
      .map((part, index) => {
        if (part.startsWith('`') && part.endsWith('`')) {
          return part.slice(1, -1);
        }
        if (part.startsWith('**') && part.endsWith('**')) {
          return (
            <Text key={index} size={12.5} weight={600}>
              {part.slice(2, -2)}
            </Text>
          );
        }
        const link = part.match(/^\[([^\]]+)\](?:\(([^)]+)\)|\[([^\]]+)\])$/);
        if (link) {
          const url = link[2] ?? (link[3] ? references.get(link[3].toLowerCase()) : undefined);
          if (url && onOpenLink && isSafeExternalHttps(url)) {
            return (
              <Pressable key={index} onActivate={() => onOpenLink(url)}>
                <Text size={12.5} style={{ typography: { color: colorToken('accent') } }}>
                  {link[1]}
                </Text>
              </Pressable>
            );
          }
          return link[1] ?? '';
        }
        return part;
      });

  const blocks: ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (!line.trim()) continue;
    if (line.startsWith('```')) {
      const codeLines: string[] = [];
      while (++i < lines.length && !(lines[i] ?? '').startsWith('```')) {
        codeLines.push(lines[i] ?? '');
      }
      blocks.push(
        <Box
          key={i}
          style={{
            layout: { width: pct(100), padding: insets(10, 12) },
            material: new SolidMaterial(colorToken('surface')),
            border: { width: 1, color: colorToken('borderSubtle') },
            corners: corners(10),
          }}
        >
          <Text size={12} tone="secondary">
            {codeLines.join('\n')}
          </Text>
        </Box>,
      );
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)/);
    if (heading?.[1] && heading[2]) {
      blocks.push(
        <Heading
          key={i}
          level={heading[1].length <= 2 ? 3 : 4}
          size={heading[1].length <= 2 ? 15 : 13.5}
        >
          {inlineParts(heading[2])}
        </Heading>,
      );
      continue;
    }
    if (/^\s*[-*]\s/.test(line)) {
      const items: string[] = [line.replace(/^\s*[-*]\s/, '')];
      while (i + 1 < lines.length && /^\s*[-*]\s/.test(lines[i + 1] ?? '')) {
        i += 1;
        items.push((lines[i] ?? '').replace(/^\s*[-*]\s/, ''));
      }
      blocks.push(
        <Stack
          key={i}
          gapPx={4}
          style={{ layout: { width: pct(100), padding: insets(0, 0, 0, 8) } }}
        >
          {items.map((item, idx) => (
            <Text key={idx} size={12.5} tone="secondary">
              {'• '}
              {inlineParts(item)}
            </Text>
          ))}
        </Stack>,
      );
      continue;
    }
    const paragraph = [line];
    while (
      i + 1 < lines.length &&
      (lines[i + 1] ?? '').trim() &&
      !/^(?:#|```|\s*[-*]\s)/.test(lines[i + 1] ?? '')
    ) {
      i += 1;
      paragraph.push(lines[i] ?? '');
    }
    blocks.push(
      <Text key={i} size={12.5} tone="secondary">
        {inlineParts(paragraph.join(' '))}
      </Text>,
    );
  }

  return (
    <Stack gapPx={8} style={{ layout: { width: pct(100) } }}>
      {blocks}
    </Stack>
  );
}

export function HacsRepositoryDetailsView({
  repository,
  releases,
  notes,
  selectedVersion,
  reading,
  busy,
  error,
  onSelectVersion,
  onToggleBeta,
  onDownload,
  onSetupIntegration,
  onRefresh,
  onOpenSource,
  onRemoveDownload,
  onRemoveCustom,
  onBack,
}: {
  readonly repository: CommunityRepository;
  readonly releases: readonly HacsReleaseTag[];
  readonly notes: readonly HacsReleaseNote[];
  readonly selectedVersion: string;
  readonly reading: boolean;
  readonly busy: boolean;
  readonly error?: string;
  readonly onSelectVersion: (version: string) => void;
  readonly onToggleBeta: (showBeta: boolean) => void;
  readonly onDownload: () => void;
  readonly onSetupIntegration?: (domain: string) => void;
  readonly onRefresh: () => void;
  readonly onOpenSource?: (url: string) => void;
  readonly onRemoveDownload: () => void;
  readonly onRemoveCustom: () => void;
  readonly onBack: () => void;
}) {
  const [tab, setTab] = useState<'overview' | 'releases'>('overview');
  const versionOptions = buildHacsVersionOptions(repository, releases).map((tag) => ({
    value: tag,
    label: tag,
  }));

  return (
    <Stack gapPx={16} style={{ layout: { width: pct(100) } }}>
      <Row align="center" justify="between" gapPx={10}>
        <HausButton id="hacs-details-back" variant="ghost" size="sm" onPress={onBack}>
          <UiIcon name="arrow-left" size={16} />
          <Text size={13}>Back</Text>
        </HausButton>
      </Row>

      <Stack gapPx={3}>
        <Heading level={2} size={20} weight={600}>
          {repository.name}
        </Heading>
        <Text size={12.5} tone="muted">
          {repository.full_name}
        </Text>
      </Stack>

      {error && (
        <Text size={12.5} tone="critical">
          {error}
        </Text>
      )}
      {reading && (
        <Text size={12.5} tone="muted">
          Reading repository details…
        </Text>
      )}
      {repository.description && (
        <Text size={13} tone="secondary">
          {repository.description}
        </Text>
      )}

      <Row
        gapPx={18}
        wrap
        style={{
          layout: { width: pct(100), padding: insets(12, 14) },
          material: new SolidMaterial(colorToken('surfaceSecondary')),
          border: { width: 1, color: colorToken('border') },
          corners: corners(14),
        }}
      >
        <Stack gapPx={2}>
          <Text size={11} tone="muted">
            Installed
          </Text>
          <Text size={13} weight={600}>
            {repository.installed_version || 'Not installed'}
          </Text>
        </Stack>
        <Stack gapPx={2}>
          <Text size={11} tone="muted">
            Latest
          </Text>
          <Text size={13} weight={600}>
            {repository.available_version || 'Default branch'}
          </Text>
        </Stack>
        <Stack gapPx={2}>
          <Text size={11} tone="muted">
            Type
          </Text>
          <Text size={13} weight={600}>
            {repository.category}
          </Text>
        </Stack>
      </Row>

      <Row gapPx={8} wrap>
        <HausButton
          id="hacs-download-btn"
          variant="primary"
          size="sm"
          disabled={busy || reading || repository.can_download === false}
          onPress={onDownload}
        >
          {repository.pending_upgrade
            ? 'Update'
            : repository.installed
              ? 'Download version'
              : 'Install'}
        </HausButton>
        {repository.installed &&
          repository.config_flow &&
          repository.domain &&
          onSetupIntegration && (
            <HausButton
              id="hacs-setup-integration"
              variant="secondary"
              size="sm"
              disabled={busy}
              onPress={() => onSetupIntegration(repository.domain!)}
            >
              Set up integration
            </HausButton>
          )}
        <HausButton
          id="hacs-details-refresh"
          variant="secondary"
          size="sm"
          disabled={busy}
          onPress={onRefresh}
        >
          <UiIcon name="refresh-cw" size={14} />
          <Text size={12.5}>Refresh</Text>
        </HausButton>
        {onOpenSource && (
          <HausButton
            id="hacs-details-source"
            variant="ghost"
            size="sm"
            onPress={() => onOpenSource(`https://github.com/${repository.full_name}`)}
          >
            <UiIcon name="external-link" size={14} />
            <Text size={12.5}>Source</Text>
          </HausButton>
        )}
      </Row>

      <Row align="center" justify="between" gapPx={12} wrap>
        <Stack gapPx={4} style={{ layout: { minWidth: px(180) } }}>
          <Text size={12} weight={600}>
            Version
          </Text>
          <SelectInput
            id="hacs-version-select"
            ariaLabel="Repository version"
            value={selectedVersion}
            disabled={busy || reading || versionOptions.length === 0}
            options={versionOptions}
            onChange={onSelectVersion}
          />
        </Stack>
        <HausSwitch
          id="hacs-beta-toggle"
          label="Include beta releases"
          checked={Boolean(repository.beta)}
          disabled={busy || reading}
          onChange={onToggleBeta}
        />
      </Row>

      <Row gapPx={8}>
        <Pressable
          id="hacs-tab-overview"
          ariaPressed={tab === 'overview'}
          onActivate={() => setTab('overview')}
          style={{
            layout: { direction: 'row', alignItems: 'center', padding: insets(6, 12) },
            material: new SolidMaterial(
              tab === 'overview' ? colorToken('surfaceActive') : colorToken('surfaceSecondary'),
            ),
            border: {
              width: 1,
              color: tab === 'overview' ? colorToken('accent') : colorToken('border'),
            },
            corners: corners(999),
          }}
        >
          <Text size={12} weight={tab === 'overview' ? 600 : 500}>
            Overview
          </Text>
        </Pressable>
        <Pressable
          id="hacs-tab-releases"
          ariaPressed={tab === 'releases'}
          onActivate={() => setTab('releases')}
          style={{
            layout: { direction: 'row', alignItems: 'center', padding: insets(6, 12) },
            material: new SolidMaterial(
              tab === 'releases' ? colorToken('surfaceActive') : colorToken('surfaceSecondary'),
            ),
            border: {
              width: 1,
              color: tab === 'releases' ? colorToken('accent') : colorToken('border'),
            },
            corners: corners(999),
          }}
        >
          <Text size={12} weight={tab === 'releases' ? 600 : 500}>
            Release notes
          </Text>
        </Pressable>
      </Row>

      <Box
        style={{
          layout: { width: pct(100), padding: insets(14, 16) },
          material: new SolidMaterial(colorToken('surfaceSecondary')),
          border: { width: 1, color: colorToken('border') },
          corners: corners(14),
        }}
      >
        {tab === 'overview' ? (
          <PortableMarkdown
            text={repository.additional_info || 'No additional documentation was provided.'}
            onOpenLink={onOpenSource}
          />
        ) : notes.length > 0 ? (
          <Stack gapPx={12} style={{ layout: { width: pct(100) } }}>
            {notes.map((note) => (
              <Stack key={note.tag} gapPx={4} style={{ layout: { width: pct(100) } }}>
                <Heading level={3} size={15}>
                  {note.name || note.tag}
                </Heading>
                <PortableMarkdown text={note.body} onOpenLink={onOpenSource} />
              </Stack>
            ))}
          </Stack>
        ) : (
          <Text size={12.5} tone="muted">
            No newer release notes are available.
          </Text>
        )}
      </Box>

      {(repository.installed || (repository.custom && !repository.installed)) && (
        <Row gapPx={8} wrap>
          {repository.installed && (
            <HausButton
              id="hacs-remove-download"
              variant="danger"
              size="sm"
              disabled={busy}
              onPress={onRemoveDownload}
            >
              Remove download
            </HausButton>
          )}
          {repository.custom && !repository.installed && (
            <HausButton
              id="hacs-remove-custom"
              variant="danger"
              size="sm"
              disabled={busy}
              onPress={onRemoveCustom}
            >
              Remove custom repository
            </HausButton>
          )}
        </Row>
      )}
    </Stack>
  );
}
