import { useEffect, useState } from 'react';
import { Button } from '@heroui/react';
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
      icon={<BrandIcon kind="integration" id={info.domain || 'hacs'} />}
      onBack={onBack}
    >
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {reading && (
        <p role="status" className="management-loading">
          Reading repository details…
        </p>
      )}
      <p className="flow-description">{info.description}</p>
      <div className="addon-facts">
        <span>
          Installed<strong>{info.installed_version || 'Not installed'}</strong>
        </span>
        <span>
          Latest<strong>{info.available_version || 'Default branch'}</strong>
        </span>
        <span>
          Type<strong>{info.category}</strong>
        </span>
      </div>
      <div className="management-action-row">
        <Button
          isDisabled={busy || reading || info.can_download === false}
          onPress={() =>
            onConfirm({
              title: `${info.installed ? 'Download' : 'Install'} ${info.name}?`,
              label: info.installed ? 'Download version' : 'Install',
              description: `${version || info.available_version || 'The selected version'} will be downloaded to your home server. Integrations may need a Home Assistant restart.`,
              action: () =>
                hacs('repository/download', {
                  repository: String(info.id),
                  ...(version ? { version } : {}),
                }),
            })
          }
        >
          {info.pending_upgrade ? 'Update' : info.installed ? 'Download version' : 'Install'}
        </Button>
        {info.installed && info.config_flow && info.domain && (
          <Button
            variant="secondary"
            isDisabled={busy}
            onPress={() => onFlow({ domain: info.domain })}
          >
            Set up integration
          </Button>
        )}
        <Button
          variant="secondary"
          isDisabled={busy}
          onPress={() => void mutate('repository/refresh')}
        >
          <RefreshCw size={16} />
          Refresh
        </Button>
        <Button
          variant="ghost"
          onPress={() =>
            void nativeApi()
              .openExternal(`https://github.com/${info.full_name}`)
              .catch((reason) => setError(reason.message))
          }
        >
          <ExternalLink size={16} />
          Source
        </Button>
      </div>
      <div className="hacs-release-settings">
        <label className="management-field">
          <span>Version</span>
          <select
            value={version}
            disabled={busy || reading}
            onChange={(event) => setVersion(event.target.value)}
          >
            {[
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
            ].map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>
        </label>
        <label className="management-check">
          <input
            type="checkbox"
            checked={!!info.beta}
            disabled={busy || reading}
            onChange={(event) =>
              void mutate('repository/beta', { show_beta: event.target.checked })
            }
          />
          <span>Include beta releases</span>
        </label>
      </div>
      <div className="filter-tabs">
        <Button
          variant="ghost"
          aria-pressed={tab === 'overview'}
          onPress={() => setTab('overview')}
        >
          Overview
        </Button>
        <Button
          variant="ghost"
          aria-pressed={tab === 'releases'}
          onPress={() => setTab('releases')}
        >
          Release notes
        </Button>
      </div>
      <div className="hacs-repository-content">
        {tab === 'overview' ? (
          <ServerMarkdown
            text={info.additional_info || 'No additional documentation was provided.'}
          />
        ) : notes.length ? (
          notes.map((note) => (
            <section key={note.tag}>
              <h3>{note.name || note.tag}</h3>
              <ServerMarkdown text={note.body} />
            </section>
          ))
        ) : (
          <p className="management-hint">No newer release notes are available.</p>
        )}
      </div>
      <div className="management-action-row">
        {info.installed && (
          <Button
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
          </Button>
        )}
        {info.custom && !info.installed && (
          <Button
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
          </Button>
        )}
      </div>
    </ConnectionDetailLayout>
  );
}
