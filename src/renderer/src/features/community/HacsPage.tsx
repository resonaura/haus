import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@heroui/react';
import { Plus, RefreshCw, Search } from 'lucide-react';
import { BrandIcon } from '../../components/brand/BrandIcon';
import { ConnectionDetailLayout } from '../connections/ConnectionDetailLayout';
import { ConfirmDialog } from '../connections/ConfirmDialog';
import { ManagementFeedback, type Confirmation } from '../connections/ManagementFeedback';
import { Dialog } from '../../components/ui/Dialog';
import type { FlowTarget } from '../connections/IntegrationFlow';
import type { IntegrationEntry } from '../../ha/management';
import { HacsCatalog } from './HacsCatalog';
import { HacsRepositoryDetails } from './HacsRepositoryDetails';
import {
  hacs,
  communityRepositoryName,
  filterCommunity,
  type CommunityRepository,
  type HacsInfo,
  type CriticalRepository,
} from './hacs';

export function HacsPage({
  entry,
  onBack,
  onFlow,
}: {
  entry?: IntegrationEntry;
  onBack: () => void;
  onFlow: (flow: FlowTarget) => void;
}) {
  const pending = useRef(false);
  const [repositories, setRepositories] = useState<CommunityRepository[]>([]),
    [info, setInfo] = useState<HacsInfo>(),
    [critical, setCritical] = useState<CriticalRepository[]>([]);
  const [removed, setRemoved] = useState<Array<{ repository: string; reason?: string }>>([]);
  const [query, setQuery] = useState(''),
    [scope, setScope] = useState('installed'),
    [category, setCategory] = useState('all');
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<CommunityRepository>(),
    [confirm, setConfirm] = useState<Confirmation | null>(null),
    [adding, setAdding] = useState(false),
    [source, setSource] = useState(''),
    [sourceCategory, setSourceCategory] = useState('integration');
  const load = useCallback(async () => {
    const [status, list, alerts, retired] = await Promise.all([
      hacs<HacsInfo>('info'),
      hacs<CommunityRepository[]>('repositories/list'),
      hacs<CriticalRepository[]>('critical/list'),
      hacs<typeof removed>('repositories/removed'),
    ]);
    setInfo(status);
    setRepositories(list);
    setCritical(alerts);
    setRemoved(retired);
    setRevision((value) => value + 1);
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    void load()
      .catch((reason) => {
        if (active) setError(reason.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [load]);
  const perform = async (operation: () => Promise<unknown>, success = 'Changes saved.') => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    setConfirm(null);
    try {
      await operation();
      await load();
      setNotice(success);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The community operation failed.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const filtered = useMemo(
    () => filterCommunity(repositories, query, scope, category),
    [repositories, query, scope, category],
  );
  const feedback = <ManagementFeedback error={error} notice={notice} />;
  const dialogs = (
    <>
      {confirm && (
        <ConfirmDialog
          confirmation={confirm}
          busy={busy}
          onClose={() => setConfirm(null)}
          onConfirm={() =>
            void perform(
              confirm.action,
              'Operation completed. Integrations may need a Home Assistant restart.',
            )
          }
        />
      )}
      {adding && (
        <Dialog
          title="Add community source"
          onClose={() => {
            if (!busy) setAdding(false);
          }}
        >
          <form
            id="hacs-add-source"
            onSubmit={(event) => {
              event.preventDefault();
              void perform(async () => {
                const repository = communityRepositoryName(source);
                await hacs('repositories/add', { repository, category: sourceCategory });
                const list = await hacs<CommunityRepository[]>('repositories/list');
                if (!list.some((item) => item.full_name.toLowerCase() === repository.toLowerCase()))
                  throw Error('The source could not be added. Check its category and HACS logs.');
                setAdding(false);
                setSource('');
              }, 'Community source added.');
            }}
          >
            <label className="management-field">
              <span>GitHub repository</span>
              <input
                value={source}
                required
                placeholder="owner/repository"
                onChange={(event) => setSource(event.target.value)}
              />
            </label>
            <label className="management-field">
              <span>Type</span>
              <select
                value={sourceCategory}
                onChange={(event) => setSourceCategory(event.target.value)}
              >
                {(info?.categories ?? ['integration', 'plugin', 'theme', 'template']).map(
                  (value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ),
                )}
              </select>
            </label>
            {feedback}
            <Button type="submit" isPending={busy}>
              Add source
            </Button>
          </form>
        </Dialog>
      )}
    </>
  );
  if (selected)
    return (
      <>
        {feedback}
        <HacsRepositoryDetails
          repository={selected}
          revision={revision}
          busy={busy}
          onBack={() => setSelected(undefined)}
          onPerform={perform}
          onConfirm={setConfirm}
          onFlow={onFlow}
        />
        {dialogs}
      </>
    );
  return (
    <>
      <ConnectionDetailLayout
        title="Community"
        subtitle={`HACS ${info?.version ?? ''} · Integrations and ideas from the community`}
        icon={<BrandIcon kind="integration" id="hacs" />}
        onBack={onBack}
        actions={
          <>
            <Button
              variant="secondary"
              isDisabled={busy || loading}
              onPress={() => setAdding(true)}
            >
              <Plus size={15} />
              Add source
            </Button>
            {entry?.supports_options && (
              <Button
                variant="ghost"
                onPress={() => onFlow({ domain: 'hacs', entryId: entry.entry_id, kind: 'options' })}
              >
                Settings
              </Button>
            )}
          </>
        }
      >
        {feedback}
        {loading && (
          <p role="status" className="management-loading">
            Reading community catalog…
          </p>
        )}
        {info?.disabled_reason && (
          <p className="form-error">HACS needs attention: {info.disabled_reason}</p>
        )}
        {critical
          .filter((item) => !item.acknowledged)
          .map((item) => (
            <article className="integration-repair" key={item.repository}>
              <div>
                <h3>{item.repository}</h3>
                <p>{item.reason || 'HACS has reported an important issue with this repository.'}</p>
              </div>
              <Button
                variant="secondary"
                isDisabled={busy}
                onPress={() =>
                  setConfirm({
                    title: 'Acknowledge repository warning?',
                    label: 'Acknowledge',
                    description:
                      'This dismisses the warning after you have reviewed it. It does not repair or reinstall the repository.',
                    action: () => hacs('critical/acknowledge', { repository: item.repository }),
                  })
                }
              >
                Reviewed
              </Button>
            </article>
          ))}
        <div className="management-toolbar">
          <label className="management-search">
            <Search size={17} />
            <input
              aria-label="Search community"
              placeholder="Find a community integration or resource"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <select
            aria-label="Community category"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            <option value="all">Every type</option>
            {info?.categories.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <Button
            variant="ghost"
            isDisabled={busy || loading}
            onPress={() => void perform(async () => {}, 'Catalog refreshed.')}
          >
            <RefreshCw size={16} />
          </Button>
        </div>
        <div className="filter-tabs">
          {['installed', 'updates', 'browse', 'hidden', 'removed'].map((value) => (
            <Button
              key={value}
              variant="ghost"
              aria-pressed={scope === value}
              onPress={() => setScope(value)}
            >
              {value === 'browse' ? 'Explore' : value[0].toUpperCase() + value.slice(1)}
              {value === 'updates' &&
                ` · ${repositories.filter((repo) => repo.pending_upgrade).length}`}
            </Button>
          ))}
        </div>
        {scope === 'removed' ? (
          <div>
            {removed.length ? (
              removed.map((item) => (
                <article className="integration-repair" key={item.repository}>
                  <div>
                    <h3>{item.repository}</h3>
                    <p>{item.reason || 'This repository is no longer offered by HACS.'}</p>
                  </div>
                </article>
              ))
            ) : (
              <p className="management-hint">No removed sources need attention.</p>
            )}
          </div>
        ) : (
          <>
            <p className="management-hint">
              {filtered.length.toLocaleString()} {filtered.length === 1 ? 'resource' : 'resources'}
            </p>
            {!!filtered.length && <HacsCatalog repositories={filtered} onSelect={setSelected} />}{' '}
            {!loading && !filtered.length && (
              <div className="management-empty">
                <h3>No matches</h3>
                <p>Try another type or search term.</p>
              </div>
            )}
          </>
        )}
      </ConnectionDetailLayout>
      {dialogs}
    </>
  );
}
