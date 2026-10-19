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
} from 'lucide-react';
import type { Snapshot } from '../../model';
import {
  humanize,
  nativeApi,
  supervisor,
  type AddonInfo,
  type IntegrationEntry,
} from '../../ha/management';
import { BrandIcon } from '../../components/brand/BrandIcon';
import { IntegrationFlow, type FlowTarget } from './IntegrationFlow';

import { type Confirmation, type Repository } from './ManagementFeedback';
import { ConfirmDialog } from './ConfirmDialog';
import { IntegrationDetails } from './IntegrationDetails';
import { AddonDetails } from './AddonDetails';
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
      {!loading && !demo && kind === 'integrations' && !filteredGroups.length && (
        <div className="management-empty">
          <Cable size={28} />
          <h3>No matching integrations</h3>
          <p>Try another name or choose a different filter.</p>
          <Button
            variant="secondary"
            onPress={() => {
              setQuery('');
              setFilter('all');
            }}
          >
            Clear filters
          </Button>
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
              <article
                className="integration-card"
                key={group.domain}
                data-attention={group.entries.some(issue) || undefined}
              >
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
