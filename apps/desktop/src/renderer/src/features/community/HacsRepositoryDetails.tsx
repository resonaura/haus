/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useState } from 'react';
import { Box, CheckboxInput, HausButton, Heading, SelectInput, Text } from '@haus/ui';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { ConnectionDetailLayout } from '../connections/ConnectionDetailLayout';
import { BrandIcon } from '../../components/brand/BrandIcon';
import { ServerMarkdown } from '../../components/ui/ServerMarkdown';
import type { Confirmation } from '../connections/ManagementFeedback';
import type { FlowTarget } from '../connections/IntegrationFlow';
import { nativeApi } from '../../ha/management';
import { hacs, type CommunityRepository } from './hacs';
export function HacsRepositoryDetails({
  repository,
  revision,
  busy,
  onBack,
  onPerform,
  onConfirm,
  onFlow,
}: {
  repository: CommunityRepository;
  revision: number;
  busy: boolean;
  onBack: () => void;
  onPerform: (operation: () => Promise<unknown>, notice?: string) => Promise<void>;
  onConfirm: (confirmation: Confirmation) => void;
  onFlow: (flow: FlowTarget) => void;
}) {
  const [info, setInfo] = useState(repository),
    [version, setVersion] = useState(''),
    [tab, setTab] = useState('overview'),
    [error, setError] = useState(''),
    [reading, setReading] = useState(true);
  const [releases, setReleases] = useState<
      Array<{ tag: string; name: string; prerelease?: boolean }>
    >([]),
    [notes, setNotes] = useState<Array<{ tag: string; name: string; body: string }>>([]);
  useEffect(() => {
    let active = true;
    setReading(true);
    setError('');
    void hacs<CommunityRepository>('repository/info', { repository_id: String(repository.id) })
      .then((details) => {
        if (!active) return;
        setInfo({ ...repository, ...details });
        setVersion(details.selected_tag ?? details.available_version ?? '');
        // Slow release lookups must not hide already-loaded documentation or controls.
        void Promise.all([
          hacs<typeof releases>('repository/releases', {
            repository_id: String(repository.id),
          }).catch(() => []),
          hacs<typeof notes>('repository/release_notes', {
            repository: String(repository.id),
          }).catch(() => []),
        ]).then(([tags, changelog]) => {
          if (active) {
            setReleases(tags);
            setNotes(changelog);
          }
        });
      })
      .catch((reason) => {
        if (active) setError(reason.message);
      })
      .finally(() => {
        if (active) setReading(false);
      });
    return () => {
      active = false;
    };
  }, [repository.id, revision]);
  const mutate = (command: string, fields: Record<string, unknown> = {}) =>
    onPerform(() => hacs(command, { repository: String(repository.id), ...fields }));
  return (
    <ConnectionDetailLayout
      title={info.name}
      subtitle={info.full_name}
      icon={
        <BrandIcon
          kind="hacs"
          id={info.domain || info.full_name}
          hint={{
            name: info.name,
            repositoryUrl: info.full_name,
            ...(info.category ? { category: info.category } : {}),
          }}
        />
      }
      onBack={onBack}
    >
      {error && (
        <Text semantic="p" className="form-error" role="alert">
          {error}
        </Text>
      )}
      {reading && (
        <Text semantic="p" role="status" className="management-loading">
          Reading repository details…
        </Text>
      )}
      <Text semantic="p" className="flow-description">
        {info.description}
      </Text>
      <Box className="addon-facts">
        <Text>
          Installed<Text semantic="strong">{info.installed_version || 'Not installed'}</Text>
        </Text>
        <Text>
          Latest<Text semantic="strong">{info.available_version || 'Default branch'}</Text>
        </Text>
        <Text>
          Type<Text semantic="strong">{info.category}</Text>
        </Text>
      </Box>
      <Box className="management-action-row">
        <HausButton
          isDisabled={busy || reading || info.can_download === false}
          onPress={() =>
            onConfirm({
              title: `${info.installed ? 'Download' : 'Install'} ${info.name}?`,
              label: info.installed ? 'Download version' : 'Install',
              description: `${version || info.available_version || 'The selected version'} will be downloaded to your home server. Integrations may need a runtime restart.`,
              action: () =>
                hacs('repository/download', {
                  repository: String(info.id),
                  ...(version ? { version } : {}),
                }),
            })
          }
        >
          {info.pending_upgrade ? 'Update' : info.installed ? 'Download version' : 'Install'}
        </HausButton>
        {info.installed && info.config_flow && info.domain && (
          <HausButton
            variant="secondary"
            isDisabled={busy}
            onPress={() => onFlow({ domain: info.domain })}
          >
            Set up integration
          </HausButton>
        )}
        <HausButton
          variant="secondary"
          isDisabled={busy}
          onPress={() => void mutate('repository/refresh')}
        >
          <RefreshCw size={16} />
          Refresh
        </HausButton>
        <HausButton
          variant="ghost"
          onPress={() =>
            void nativeApi()
              .openExternal(`https://github.com/${info.full_name}`)
              .catch((reason) => setError(reason.message))
          }
        >
          <ExternalLink size={16} />
          Source
        </HausButton>
      </Box>
      <Box className="hacs-release-settings">
        <Text semantic="label" className="management-field">
          <Text>Version</Text>
          <SelectInput
            value={version}
            disabled={busy || reading}
            options={[
              ...new Set(
                [
                  info.available_version,
                  info.installed_version,
                  ...releases
                    .filter((item) => info.beta || !item.prerelease)
                    .map((item) => item.tag),
                  !info.hide_default_branch && info.default_branch,
                ].filter((value): value is string => Boolean(value)),
              ),
            ].map((tag) => ({ value: tag, label: tag }))}
            onChange={setVersion}
          />
        </Text>
        <Text semantic="label" className="management-check">
          <CheckboxInput
            checked={!!info.beta}
            disabled={busy || reading}
            onChange={(checked) => void mutate('repository/beta', { show_beta: checked })}
          />
          <Text>Include beta releases</Text>
        </Text>
      </Box>
      <Box className="filter-tabs">
        <HausButton
          variant="ghost"
          aria-pressed={tab === 'overview'}
          onPress={() => setTab('overview')}
        >
          Overview
        </HausButton>
        <HausButton
          variant="ghost"
          aria-pressed={tab === 'releases'}
          onPress={() => setTab('releases')}
        >
          Release notes
        </HausButton>
      </Box>
      <Box className="hacs-repository-content">
        {tab === 'overview' ? (
          <ServerMarkdown
            text={info.additional_info || 'No additional documentation was provided.'}
          />
        ) : notes.length ? (
          notes.map((note) => (
            <Box semantic="section" key={note.tag}>
              <Heading level={3}>{note.name || note.tag}</Heading>
              <ServerMarkdown text={note.body} />
            </Box>
          ))
        ) : (
          <Text semantic="p" className="management-hint">
            No newer release notes are available.
          </Text>
        )}
      </Box>
      <Box className="management-action-row">
        {info.installed && (
          <HausButton
            variant="danger-soft"
            isDisabled={busy}
            onPress={() =>
              onConfirm({
                title: `Remove ${info.name}?`,
                label: 'Remove download',
                danger: true,
                description:
                  'Downloaded files will be removed. Devices using this integration may become unavailable until it is installed again.',
                action: () => hacs('repository/remove', { repository: String(info.id) }),
              })
            }
          >
            Remove download
          </HausButton>
        )}
        {info.custom && !info.installed && (
          <HausButton
            variant="danger-soft"
            isDisabled={busy}
            onPress={() =>
              onConfirm({
                title: 'Remove custom repository?',
                label: 'Remove repository',
                danger: true,
                description: 'This source will be removed from your community catalog.',
                action: () => hacs('repositories/remove', { repository: String(info.id) }),
              })
            }
          >
            Remove custom repository
          </HausButton>
        )}
      </Box>
    </ConnectionDetailLayout>
  );
}
