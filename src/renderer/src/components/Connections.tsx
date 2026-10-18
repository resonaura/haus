import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Modal } from '@heroui/react';
import {
  Box,
  Cable,
  ChevronRight,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  Server,
  ExternalLink,
} from 'lucide-react';
import type { Snapshot } from '../model';
import {
  humanize,
  nativeApi,
  rest,
  supervisor,
  type AddonInfo,
  type IntegrationEntry,
} from '../ha/management';
import { BrandIcon } from './BrandIcon';
import { IntegrationFlow, type FlowTarget } from './IntegrationFlow';
import { JsonField, SchemaFields } from './SchemaForm';
import { ServerMarkdown } from './ServerMarkdown';

type Confirmation = {
  title: string;
  description: string;
  label: string;
  danger?: boolean;
  action: () => Promise<unknown>;
};
type Repository = { slug: string; name: string; url: string; source?: string };
function ManagementFeedback({ error, notice }: { error: string; notice: string }) {
  return (
    <>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="management-notice">
          {notice}
        </p>
      )}
    </>
  );
}
const issue = (entry: IntegrationEntry) =>
  !entry.disabled_by &&
  ['setup_error', 'migration_error', 'setup_retry', 'failed_unload'].includes(entry.state);
const nameOverrides: Record<string, string> = {
  hue: 'Philips Hue',
  ipp: 'Printers · IPP',
  eero: 'eero',
  mqtt: 'MQTT',
  esphome: 'ESPHome',
  hassio: 'Supervisor',
};

export function ConnectionsPage({
  kind,
  demo,
  snapshot,
  onAdd,
}: {
  kind: 'integrations' | 'addons';
  demo: boolean;
  snapshot: Snapshot;
  onAdd: () => void;
  openServer?: (path: string) => void;
}) {
  const [entries, setEntries] = useState<IntegrationEntry[]>([]);
  const [addons, setAddons] = useState<AddonInfo[]>([]);
  const [store, setStore] = useState<AddonInfo[]>([]);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState(false);
  const [viewStore, setViewStore] = useState(false);
  const [repositoryDialog, setRepositoryDialog] = useState(false);
  const [repositoryUrl, setRepositoryUrl] = useState('');
  const [selectedDomain, setSelectedDomain] = useState('');
  const [selectedAddon, setSelectedAddon] = useState<AddonInfo | null>(null);
  const [flow, setFlow] = useState<FlowTarget | null>(null);
  const [confirm, setConfirm] = useState<Confirmation | null>(null);
  const admin = snapshot.user.is_admin;
  const pretty = (domain: string) => titles[domain] ?? nameOverrides[domain] ?? humanize(domain);
  const load = useCallback(async () => {
    if (demo) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      if (kind === 'integrations') {
        const [current, manifests] = await Promise.all([
          nativeApi().request<IntegrationEntry[]>({ type: 'config_entries/get' }),
          nativeApi().request<Array<{ domain: string; name: string }>>({ type: 'manifest/list' }),
        ]);
        setEntries(current);
        setTitles(Object.fromEntries(manifests.map((m) => [m.domain, m.name])));
      } else {
        const current = await supervisor<{ addons: AddonInfo[] }>('/addons');
        setAddons(current.addons);
        if (viewStore) {
          const catalog = await supervisor<{ addons: AddonInfo[]; repositories: Repository[] }>(
            '/store',
          );
          setStore(catalog.addons);
          setRepositories(catalog.repositories);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read your server.');
    } finally {
      setLoading(false);
    }
  }, [kind, demo, viewStore]);
  useEffect(() => {
    setQuery('');
    setFilter('all');
    void load();
  }, [load]);
  const perform = async (operation: () => Promise<unknown>, success = 'Changes saved.') => {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    setConfirm(null);
    try {
      const result = await operation();
      if (
        result &&
        typeof result === 'object' &&
        'require_restart' in result &&
        result.require_restart
      )
        setNotice('Saved. Home Assistant needs a restart to apply this change.');
      else setNotice(success);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The operation could not be completed.');
    } finally {
      setBusy(false);
    }
  };
  const groups = useMemo(
    () =>
      [...new Set(entries.map((e) => e.domain))].map((domain) => ({
        domain,
        entries: entries.filter((e) => e.domain === domain),
      })),
    [entries],
  );
  const filteredGroups = groups
    .map((group) => ({
      ...group,
      entries: group.entries.filter(
        (e) =>
          filter === 'all' ||
          (filter === 'issues'
            ? issue(e)
            : filter === 'disabled'
              ? !!e.disabled_by
              : e.state === 'loaded'),
      ),
    }))
    .filter(
      (g) =>
        g.entries.length &&
        `${pretty(g.domain)} ${g.entries.map((e) => e.title).join(' ')}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) => pretty(a.domain).localeCompare(pretty(b.domain)));
  const filteredAddons = (viewStore ? store : addons).filter(
    (a) =>
      `${a.name} ${a.description}`.toLowerCase().includes(query.toLowerCase()) &&
      (viewStore ||
        filter === 'all' ||
        (filter === 'updates' ? a.update_available : a.state === filter)),
  );
  const addonAction = (addon: AddonInfo, action: string) => {
    const installed = addons.some((a) => a.slug === addon.slug);
    const operation = () =>
      action === 'update'
        ? nativeApi().request({ type: 'hassio/update/addon', addon: addon.slug, backup: true })
        : supervisor(
            `/addons/${addon.slug}/${action}`,
            'post',
            action === 'uninstall' ? { remove_config: false } : undefined,
          );
    if (action === 'start') {
      void perform(operation, `${addon.name} started.`);
      return;
    }
    setConfirm({
      title: `${humanize(action)} ${addon.name}?`,
      label: humanize(action),
      danger: action === 'uninstall',
      description:
        action === 'update'
          ? `Update ${addon.version ?? ''} to ${addon.version_latest ?? 'the latest version'}. A backup will be created first.`
          : action === 'uninstall'
            ? 'The add-on will be removed. Its configuration will be kept so it can be installed again.'
            : action === 'install'
              ? 'This will install the add-on on your Home Assistant server. Review its details and required access before continuing.'
              : installed
                ? 'Devices and services that depend on this add-on may be temporarily unavailable.'
                : 'Apply this operation on your Home Assistant server.',
      action: operation,
    });
  };
  return (
    <div className="connections-page">
      <div className="management-intro">
        <span className="management-intro-icon">
          {kind === 'integrations' ? <Cable size={25} /> : <Box size={25} />}
        </span>
        <div>
          <strong>
            {kind === 'integrations'
              ? 'Everything speaks the same language.'
              : viewStore
                ? 'More possibilities for your home.'
                : 'The services behind your home.'}
          </strong>
          <p>
            {kind === 'integrations'
              ? 'Connect, configure and manage your integrations here.'
              : 'Install, configure and maintain the services on your server.'}
          </p>
        </div>
        <Button
          variant="secondary"
          isDisabled={!admin || demo}
          onPress={() => (kind === 'integrations' ? setFlow({}) : setViewStore(!viewStore))}
        >
          <Plus size={16} />
          {kind === 'integrations'
            ? 'Add integration'
            : viewStore
              ? 'Installed add-ons'
              : 'Add-on store'}
        </Button>
      </div>
      <div className="management-toolbar">
        <label className="management-search">
          <Search size={17} />
          <input
            aria-label={`Search ${kind}`}
            placeholder={`Search ${viewStore ? 'add-on store' : kind}…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {viewStore && (
          <Button variant="ghost" onPress={() => setRepositoryDialog(true)}>
            Repositories
          </Button>
        )}
        <button className="refresh-button" disabled={loading || busy} onClick={() => void load()}>
          <RefreshCw size={16} className={loading ? 'spin' : ''} />
          Refresh
        </button>
      </div>
      {!viewStore && (
        <div className="filter-tabs">
          {(kind === 'integrations'
            ? [
                { id: 'all', label: 'All', count: entries.length },
                {
                  id: 'loaded',
                  label: 'Connected',
                  count: entries.filter((e) => e.state === 'loaded').length,
                },
                { id: 'issues', label: 'Needs attention', count: entries.filter(issue).length },
                {
                  id: 'disabled',
                  label: 'Disabled',
                  count: entries.filter((e) => e.disabled_by).length,
                },
              ]
            : [
                { id: 'all', label: 'Installed', count: addons.length },
                {
                  id: 'started',
                  label: 'Running',
                  count: addons.filter((a) => a.state === 'started').length,
                },
                {
                  id: 'stopped',
                  label: 'Stopped',
                  count: addons.filter((a) => a.state === 'stopped').length,
                },
                {
                  id: 'updates',
                  label: 'Updates',
                  count: addons.filter((a) => a.update_available).length,
                },
              ]
          ).map((f) => (
            <button
              key={f.id}
              className={filter === f.id ? 'selected' : ''}
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
              <span>{f.count}</span>
            </button>
          ))}
        </div>
      )}
      {error && (
        <div role="alert" className="management-error">
          <strong>Could not complete the request</strong>
          <p>{error}</p>
          <button className="text-link" onClick={() => void load()}>
            Try again
            <RefreshCw size={14} />
          </button>
        </div>
      )}
      {notice && (
        <p role="status" className="management-notice">
          {notice}
        </p>
      )}
      {busy && (
        <p role="status" className="management-loading">
          <LoaderCircle className="spin" size={18} />
          Applying changes on your server…
        </p>
      )}
      {loading && (
        <div role="status" className="management-loading">
          <LoaderCircle className="spin" size={23} />
          Reading your server…
        </div>
      )}
      {demo && (
        <div className="management-empty">
          <Server size={30} />
          <h3>Connect your home</h3>
          <p>Your live integrations and add-ons will appear here.</p>
          <Button onPress={onAdd}>Connect Home Assistant</Button>
        </div>
      )}
      {!loading && !demo && kind === 'integrations' && (
        <div className="integration-grid">
          {filteredGroups.map((group) => {
            const deviceCount = snapshot.devices.filter(
              (d) =>
                Array.isArray(d.config_entries) &&
                d.config_entries.some((id) => group.entries.some((e) => e.entry_id === id)),
            ).length;
            return (
              <article className="integration-card" key={group.domain}>
                <div className="integration-card-top">
                  <span className="integration-logo">
                    <BrandIcon kind="integration" id={group.domain} />
                  </span>
                  <span
                    className={`status-pill ${group.entries.some(issue) ? 'status-unavailable' : group.entries.some((e) => e.state === 'loaded') ? 'status-available' : 'status-disabled'}`}
                  >
                    <i />
                    {group.entries.some(issue)
                      ? 'Needs attention'
                      : group.entries.some((e) => e.state === 'loaded')
                        ? 'Connected'
                        : 'Disabled'}
                  </span>
                </div>
                <h3>{pretty(group.domain)}</h3>
                <p>
                  {deviceCount} devices · {group.entries.length}{' '}
                  {group.entries.length === 1 ? 'connection' : 'connections'}
                </p>
                <div className="integration-entry-summary">
                  {group.entries.slice(0, 2).map((entry) => (
                    <span key={entry.entry_id}>{entry.title}</span>
                  ))}
                  {group.entries.length > 2 && <small>+{group.entries.length - 2} more</small>}
                </div>
                <button
                  className="integration-manage"
                  onClick={() => setSelectedDomain(group.domain)}
                >
                  Manage
                  <ChevronRight size={14} />
                </button>
              </article>
            );
          })}
        </div>
      )}
      {!loading && !demo && kind === 'addons' && (
        <div className={viewStore ? 'addon-store-grid' : 'addon-list'}>
          {filteredAddons.map((addon) => (
            <article className="addon-card" key={addon.slug}>
              <span className="addon-glyph">
                <BrandIcon kind="addon" id={addon.slug} />
              </span>
              <div className="addon-copy">
                <div>
                  <h3>{addon.name}</h3>
                  {!viewStore && (
                    <span
                      className={`status-pill ${addon.state === 'started' ? 'status-available' : 'status-disabled'}`}
                    >
                      <i />
                      {addon.state === 'started' ? 'Running' : humanize(addon.state ?? 'Unknown')}
                    </span>
                  )}
                  {addon.update_available && <span className="update-pill">Update available</span>}
                </div>
                <p>{addon.description}</p>
                <small>
                  {addon.version
                    ? `Version ${addon.version}`
                    : addon.version_latest
                      ? `Version ${addon.version_latest}`
                      : addon.repository}
                </small>
              </div>
              <div className="addon-actions">
                <button
                  className="text-link"
                  onClick={() =>
                    setSelectedAddon({
                      ...addon,
                      installed: addons.some((a) => a.slug === addon.slug),
                    })
                  }
                >
                  {viewStore ? 'View details' : 'Manage'}
                  <ChevronRight size={14} />
                </button>
                {!viewStore && admin && (
                  <Button
                    variant="secondary"
                    isDisabled={busy}
                    onPress={() => addonAction(addon, addon.state === 'started' ? 'stop' : 'start')}
                  >
                    {addon.state === 'started' ? 'Stop' : 'Start'}
                  </Button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      {!loading &&
        !demo &&
        !(kind === 'integrations' ? filteredGroups.length : filteredAddons.length) && (
          <div className="management-empty">
            <Search size={28} />
            <h3>No matches</h3>
            <p>Try another name or filter.</p>
          </div>
        )}
      {selectedDomain && (
        <IntegrationDetails
          name={pretty(selectedDomain)}
          entries={entries.filter((e) => e.domain === selectedDomain)}
          snapshot={snapshot}
          busy={busy}
          feedback={{ error, notice }}
          onClose={() => setSelectedDomain('')}
          onFlow={setFlow}
          onChange={perform}
          onConfirm={setConfirm}
        />
      )}
      {selectedAddon && (
        <AddonDetails
          addon={selectedAddon}
          snapshot={snapshot}
          busy={busy}
          feedback={{ error, notice }}
          onClose={() => setSelectedAddon(null)}
          onAction={addonAction}
          onChange={perform}
          revision={addons}
        />
      )}
      {flow && (
        <IntegrationFlow
          target={flow}
          snapshot={snapshot}
          onClose={() => {
            setFlow(null);
            void load();
          }}
          onDone={() => void load()}
        />
      )}
      {confirm && (
        <ConfirmDialog
          confirmation={confirm}
          busy={busy}
          onClose={() => setConfirm(null)}
          onConfirm={() => void perform(confirm.action, 'Operation completed.')}
        />
      )}
      {repositoryDialog && (
        <Modal
          isOpen
          onOpenChange={(open) => {
            if (!open) setRepositoryDialog(false);
          }}
        >
          <Modal.Backdrop variant="blur">
            <Modal.Container size="lg">
              <Modal.Dialog className="haus-dialog">
                <Modal.CloseTrigger />
                <Modal.Header>
                  <Modal.Heading>Add-on repositories</Modal.Heading>
                </Modal.Header>
                <Modal.Body>
                  <div className="repository-list">
                    {repositories.map((repo) => (
                      <div key={repo.slug}>
                        <span>
                          <strong>{repo.name}</strong>
                          <small>{repo.url ?? repo.source}</small>
                        </span>
                        {admin && !['core', 'local'].includes(repo.slug) && (
                          <Button
                            variant="ghost"
                            onPress={() =>
                              setConfirm({
                                title: `Remove ${repo.name}?`,
                                label: 'Remove repository',
                                description:
                                  'Installed add-ons remain on your server. This repository will be removed from the store.',
                                action: () =>
                                  supervisor(`/store/repositories/${repo.slug}`, 'delete'),
                              })
                            }
                          >
                            Remove
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                  <form
                    id="add-repository"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void perform(
                        () =>
                          supervisor('/store/repositories', 'post', { repository: repositoryUrl }),
                        'Repository added.',
                      );
                      setRepositoryUrl('');
                    }}
                  >
                    <label className="management-field">
                      <span>Repository URL</span>
                      <input
                        type="url"
                        required
                        value={repositoryUrl}
                        onChange={(e) => setRepositoryUrl(e.target.value)}
                        placeholder="https://github.com/…"
                      />
                    </label>
                  </form>
                </Modal.Body>
                <Modal.Footer>
                  <Button variant="ghost" onPress={() => setRepositoryDialog(false)}>
                    Done
                  </Button>
                  <Button type="submit" form="add-repository" isDisabled={busy || !admin}>
                    Add repository
                  </Button>
                </Modal.Footer>
              </Modal.Dialog>
            </Modal.Container>
          </Modal.Backdrop>
        </Modal>
      )}
    </div>
  );
}

function ConfirmDialog({
  confirmation,
  busy,
  onClose,
  onConfirm,
}: {
  confirmation: Confirmation;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Modal.Backdrop variant="blur">
        <Modal.Container>
          <Modal.Dialog className="haus-dialog">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>{confirmation.title}</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <p className="flow-description">{confirmation.description}</p>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" onPress={onClose}>
                Cancel
              </Button>
              <Button
                variant={confirmation.danger ? 'danger' : 'primary'}
                isDisabled={busy}
                onPress={onConfirm}
              >
                {confirmation.label}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

function IntegrationDetails({
  name,
  entries,
  snapshot,
  busy,
  onClose,
  onFlow,
  onChange,
  onConfirm,
  feedback,
}: {
  name: string;
  entries: IntegrationEntry[];
  snapshot: Snapshot;
  busy: boolean;
  onClose: () => void;
  onFlow: (target: FlowTarget) => void;
  onChange: (operation: () => Promise<unknown>, success?: string) => Promise<void>;
  onConfirm: (confirmation: Confirmation) => void;
  feedback: { error: string; notice: string };
}) {
  return (
    <Modal
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Modal.Backdrop variant="blur">
        <Modal.Container size="lg">
          <Modal.Dialog className="haus-dialog connection-detail-dialog">
            <Modal.CloseTrigger />
            <Modal.Header>
              <div className="management-dialog-title">
                <span className="integration-logo">
                  <BrandIcon kind="integration" id={entries[0]?.domain ?? ''} />
                </span>
                <Modal.Heading>{name}</Modal.Heading>
              </div>
            </Modal.Header>
            <Modal.Body>
              <ManagementFeedback {...feedback} />
              <div className="integration-detail-entries">
                {entries.map((entry) => (
                  <IntegrationEntryDetail
                    key={entry.entry_id}
                    entry={entry}
                    snapshot={snapshot}
                    busy={busy}
                    onFlow={onFlow}
                    onChange={onChange}
                    onConfirm={onConfirm}
                  />
                ))}
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" onPress={onClose}>
                Done
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
function IntegrationEntryDetail({
  entry,
  snapshot,
  busy,
  onFlow,
  onChange,
  onConfirm,
}: {
  entry: IntegrationEntry;
  snapshot: Snapshot;
  busy: boolean;
  onFlow: (target: FlowTarget) => void;
  onChange: (operation: () => Promise<unknown>, success?: string) => Promise<void>;
  onConfirm: (confirmation: Confirmation) => void;
}) {
  const [title, setTitle] = useState(entry.title);
  const [disableNew, setDisableNew] = useState(!!entry.pref_disable_new_entities);
  const [disablePolling, setDisablePolling] = useState(!!entry.pref_disable_polling);
  const admin = snapshot.user.is_admin;
  const devices = snapshot.devices.filter(
    (d) => Array.isArray(d.config_entries) && d.config_entries.includes(entry.entry_id),
  );
  return (
    <section className="integration-entry-detail">
      <div className="management-detail-heading">
        <h3>{entry.title}</h3>
        <span
          className={`status-pill ${issue(entry) ? 'status-unavailable' : entry.disabled_by ? 'status-disabled' : 'status-available'}`}
        >
          <i />
          {entry.disabled_by ? 'Disabled' : humanize(entry.state)}
        </span>
      </div>
      {entry.reason && <p className="form-error">{humanize(entry.reason)}</p>}
      <div className="management-action-row">
        {entry.supports_options && (
          <Button
            variant="secondary"
            isDisabled={!admin || busy}
            onPress={() =>
              onFlow({ domain: entry.domain, entryId: entry.entry_id, kind: 'options' })
            }
          >
            Options
          </Button>
        )}
        {entry.supports_reconfigure && (
          <Button
            variant="secondary"
            isDisabled={!admin || busy}
            onPress={() =>
              onFlow({ domain: entry.domain, entryId: entry.entry_id, reconfigure: true })
            }
          >
            Reconfigure
          </Button>
        )}
        <Button
          variant="secondary"
          isDisabled={!admin || busy || !!entry.disabled_by}
          onPress={() =>
            void onChange(
              () => rest('POST', `config/config_entries/entry/${entry.entry_id}/reload`),
              'Integration reloaded.',
            )
          }
        >
          Reload
        </Button>
        <Button
          variant="ghost"
          isDisabled={!admin || busy}
          onPress={() =>
            void onChange(() =>
              nativeApi().request({
                type: 'config_entries/disable',
                entry_id: entry.entry_id,
                disabled_by: entry.disabled_by ? null : 'user',
              }),
            )
          }
        >
          {entry.disabled_by ? 'Enable' : 'Disable'}
        </Button>
      </div>
      <details className="management-entry-settings">
        <summary>
          Connection settings
          <ChevronRight size={14} />
        </summary>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void onChange(() =>
              nativeApi().request({
                type: 'config_entries/update',
                entry_id: entry.entry_id,
                title,
                pref_disable_new_entities: disableNew,
                pref_disable_polling: disablePolling,
              }),
            );
          }}
        >
          <label className="management-field">
            <span>Name</span>
            <input value={title} required onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="management-check">
            <input
              type="checkbox"
              checked={disableNew}
              onChange={(e) => setDisableNew(e.target.checked)}
            />
            <span>Disable newly added entities</span>
          </label>
          <label className="management-check">
            <input
              type="checkbox"
              checked={disablePolling}
              onChange={(e) => setDisablePolling(e.target.checked)}
            />
            <span>Disable polling for updates</span>
          </label>
          <Button type="submit" variant="secondary" isDisabled={!admin || busy}>
            Save settings
          </Button>
        </form>
      </details>
      <details className="management-related-devices">
        <summary>
          {devices.length} devices
          <ChevronRight size={14} />
        </summary>
        {devices.map((device) => (
          <div key={device.id}>
            <strong>{device.name_by_user ?? device.name ?? 'Device'}</strong>
            <small>{[device.manufacturer, device.model].filter(Boolean).join(' · ')}</small>
          </div>
        ))}
      </details>
      <button
        className="management-remove"
        disabled={!admin || busy}
        onClick={() =>
          onConfirm({
            title: `Remove ${entry.title}?`,
            description:
              'This removes the integration connection and its devices and entities from Home Assistant. Related automations may need to be updated.',
            label: 'Remove integration',
            danger: true,
            action: () => rest('DELETE', `config/config_entries/entry/${entry.entry_id}`),
          })
        }
      >
        Remove integration
      </button>
    </section>
  );
}

function AddonDetails({
  addon,
  snapshot,
  busy,
  onClose,
  onAction,
  onChange,
  revision,
  feedback,
}: {
  addon: AddonInfo;
  snapshot: Snapshot;
  busy: boolean;
  onClose: () => void;
  onAction: (addon: AddonInfo, action: string) => void;
  onChange: (operation: () => Promise<unknown>, success?: string) => Promise<void>;
  revision: AddonInfo[];
  feedback: { error: string; notice: string };
}) {
  const [info, setInfo] = useState<AddonInfo | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('info');
  const [text, setText] = useState('');
  const [reading, setReading] = useState(false);
  const [options, setOptions] = useState<Record<string, unknown>>({});
  const [network, setNetwork] = useState<Record<string, unknown>>({});
  const [boot, setBoot] = useState(false);
  const [watchdog, setWatchdog] = useState(false);
  const [autoUpdate, setAutoUpdate] = useState(false);
  const [panel, setPanel] = useState(false);
  const installed = revision.some((a) => a.slug === addon.slug);
  const load = useCallback(async () => {
    setReading(true);
    setError('');
    try {
      const result = await supervisor<AddonInfo>(
        installed ? `/addons/${addon.slug}/info` : `/store/addons/${addon.slug}`,
      );
      setInfo(result);
      setOptions(result.options ?? {});
      setNetwork(result.network ?? {});
      setBoot(result.boot === 'auto');
      setWatchdog(!!result.watchdog);
      setAutoUpdate(!!result.auto_update);
      setPanel(!!result.ingress_panel);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read add-on details.');
    } finally {
      setReading(false);
    }
  }, [addon.slug, installed]);
  useEffect(() => {
    void load();
  }, [load, revision]);
  const readText = useCallback(async () => {
    setReading(true);
    setError('');
    try {
      const result = await rest<string>(
        'GET',
        `hassio/addons/${addon.slug}/${tab === 'docs' ? 'documentation' : tab === 'changes' ? 'changelog' : 'logs'}`,
      );
      setText(
        typeof result === 'string'
          ? result.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'), '')
          : JSON.stringify(result, null, 2),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read add-on data.');
    } finally {
      setReading(false);
    }
  }, [addon.slug, tab]);
  useEffect(() => {
    if (['logs', 'docs', 'changes'].includes(tab)) void readText();
  }, [tab, readText]);
  const admin = snapshot.user.is_admin;
  const current = info ?? addon;
  return (
    <Modal
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Modal.Backdrop variant="blur">
        <Modal.Container size="lg">
          <Modal.Dialog className="haus-dialog addon-detail-dialog">
            <Modal.CloseTrigger />
            <Modal.Header>
              <div className="management-dialog-title">
                <span className="addon-glyph">
                  <BrandIcon kind="addon" id={addon.slug} />
                </span>
                <div>
                  <Modal.Heading>{addon.name}</Modal.Heading>
                  <small>
                    {current.version
                      ? `Version ${current.version}`
                      : current.version_latest
                        ? `Version ${current.version_latest}`
                        : ''}
                  </small>
                </div>
              </div>
            </Modal.Header>
            <Modal.Body>
              <ManagementFeedback {...feedback} />
              <div className="filter-tabs management-detail-tabs">
                {[
                  { id: 'info', label: 'Overview' },
                  ...(installed
                    ? [
                        { id: 'options', label: 'Configuration' },
                        { id: 'logs', label: 'Logs' },
                      ]
                    : []),
                  ...(current.documentation ? [{ id: 'docs', label: 'Documentation' }] : []),
                  ...(current.changelog ? [{ id: 'changes', label: 'Changelog' }] : []),
                ].map((item) => (
                  <button
                    key={item.id}
                    aria-pressed={tab === item.id}
                    className={tab === item.id ? 'selected' : ''}
                    onClick={() => setTab(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              {error && (
                <p role="alert" className="form-error">
                  {error}
                </p>
              )}
              {reading && (
                <div className="management-loading">
                  <LoaderCircle className="spin" size={18} />
                  Loading…
                </div>
              )}
              {tab === 'info' && (
                <>
                  <p className="flow-description">{current.description}</p>
                  {current.long_description && <ServerMarkdown text={current.long_description} />}
                  <div className="addon-facts">
                    <span>
                      State
                      <strong>
                        {installed ? humanize(current.state ?? 'unknown') : 'Not installed'}
                      </strong>
                    </span>
                    <span>
                      Repository<strong>{current.repository ?? 'Unknown'}</strong>
                    </span>
                    <span>
                      Latest version<strong>{current.version_latest ?? 'Unknown'}</strong>
                    </span>
                  </div>
                  <div className="management-action-row">
                    {installed && (current.ingress || current.webui) && (
                      <Button
                        variant="secondary"
                        isDisabled={current.state !== 'started' || busy}
                        onPress={() =>
                          void nativeApi()
                            .openAddon(addon.slug)
                            .catch((e) => setError(e.message))
                        }
                      >
                        <ExternalLink size={15} />
                        Open web interface
                      </Button>
                    )}
                    {installed ? (
                      <>
                        <Button
                          isDisabled={!admin || busy}
                          variant="secondary"
                          onPress={() =>
                            onAction(current, current.state === 'started' ? 'stop' : 'start')
                          }
                        >
                          {current.state === 'started' ? 'Stop' : 'Start'}
                        </Button>
                        <Button
                          variant="secondary"
                          isDisabled={!admin || busy || current.state !== 'started'}
                          onPress={() => onAction(current, 'restart')}
                        >
                          Restart
                        </Button>
                        {current.update_available && (
                          <Button
                            isDisabled={!admin || busy}
                            onPress={() => onAction(current, 'update')}
                          >
                            Update with backup
                          </Button>
                        )}
                        {current.repository === 'local' && (
                          <Button
                            variant="ghost"
                            isDisabled={!admin || busy}
                            onPress={() => onAction(current, 'rebuild')}
                          >
                            Rebuild
                          </Button>
                        )}
                      </>
                    ) : (
                      <Button
                        isDisabled={!admin || busy || current.available === false}
                        onPress={() => onAction(current, 'install')}
                      >
                        Install add-on
                      </Button>
                    )}
                  </div>
                  {installed && !current.system_managed && (
                    <button
                      className="management-remove"
                      disabled={!admin || busy}
                      onClick={() => onAction(current, 'uninstall')}
                    >
                      Uninstall add-on
                    </button>
                  )}
                </>
              )}
              {tab === 'options' && info && (
                <form
                  id="addon-options"
                  onSubmit={(event) => {
                    event.preventDefault();
                    setError('');
                    void onChange(async () => {
                      const checked = await supervisor<{ valid: boolean; message?: string }>(
                        `/addons/${addon.slug}/options/validate`,
                        'post',
                        { options },
                      );
                      if (!checked.valid)
                        throw new Error(
                          checked.message ?? 'The add-on configuration is not valid.',
                        );
                      await supervisor(`/addons/${addon.slug}/options`, 'post', {
                        options,
                        network,
                        ...(info.boot_config !== 'manual_only'
                          ? { boot: boot ? 'auto' : 'manual' }
                          : {}),
                        watchdog,
                        auto_update: autoUpdate,
                        ...(info.ingress_panel !== undefined ? { ingress_panel: panel } : {}),
                      });
                    }, 'Add-on configuration saved. Restart the add-on if required.');
                  }}
                >
                  <h3 className="management-form-heading">Options</h3>
                  {info.schema?.length ? (
                    <SchemaFields
                      schema={info.schema}
                      values={options}
                      onChange={setOptions}
                      snapshot={snapshot}
                    />
                  ) : (
                    <JsonField
                      label="Add-on options"
                      value={options}
                      onChange={(next) => setOptions(next as Record<string, unknown>)}
                    />
                  )}
                  {!!Object.keys(network).length && (
                    <>
                      <h3 className="management-form-heading">Network ports</h3>
                      {Object.entries(network).map(([key, value]) => (
                        <label className="management-field" key={key}>
                          <span>{key}</span>
                          <input
                            type="number"
                            min={1}
                            max={65535}
                            placeholder="Disabled"
                            value={value == null ? '' : String(value)}
                            onChange={(event) =>
                              setNetwork({
                                ...network,
                                [key]: event.target.value ? event.target.valueAsNumber : null,
                              })
                            }
                          />
                        </label>
                      ))}
                    </>
                  )}
                  <h3 className="management-form-heading">Startup & maintenance</h3>
                  {info.boot_config !== 'manual_only' && (
                    <label className="management-check">
                      <input
                        type="checkbox"
                        checked={boot}
                        onChange={(e) => setBoot(e.target.checked)}
                      />
                      <span>Start on boot</span>
                    </label>
                  )}
                  <label className="management-check">
                    <input
                      type="checkbox"
                      checked={watchdog}
                      onChange={(e) => setWatchdog(e.target.checked)}
                    />
                    <span>Watchdog · restart if the add-on stops</span>
                  </label>
                  <label className="management-check">
                    <input
                      type="checkbox"
                      checked={autoUpdate}
                      onChange={(e) => setAutoUpdate(e.target.checked)}
                    />
                    <span>Automatic updates</span>
                  </label>
                  {info.ingress_panel !== undefined && (
                    <label className="management-check">
                      <input
                        type="checkbox"
                        checked={panel}
                        onChange={(e) => setPanel(e.target.checked)}
                      />
                      <span>Show in Home Assistant sidebar</span>
                    </label>
                  )}
                </form>
              )}
              {['logs', 'docs', 'changes'].includes(tab) && (
                <>
                  <div className="management-text-toolbar">
                    <span>
                      {tab === 'logs'
                        ? 'Latest server logs'
                        : tab === 'docs'
                          ? 'Documentation'
                          : 'Release notes'}
                    </span>
                    <button
                      className="text-link"
                      onClick={() => void readText()}
                      disabled={reading}
                    >
                      <RefreshCw size={14} />
                      Refresh
                    </button>
                  </div>
                  {tab === 'logs' ? (
                    <pre className="management-server-text is-log">
                      {text || (reading ? 'Loading…' : 'No content reported.')}
                    </pre>
                  ) : (
                    <ServerMarkdown
                      text={text || (reading ? 'Loading…' : 'No content reported.')}
                    />
                  )}
                </>
              )}
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" onPress={onClose}>
                Done
              </Button>
              {tab === 'options' && (
                <Button
                  type="submit"
                  form="addon-options"
                  isDisabled={!admin || busy || reading}
                  isPending={busy}
                >
                  Save configuration
                </Button>
              )}
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
