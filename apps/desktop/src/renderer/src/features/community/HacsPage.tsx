/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, HausButton, Heading, SelectInput, Text, TextInput } from '@haus/ui';
import { ArrowUpCircle, Plus, RefreshCw, Search } from 'lucide-react';
import { BrandIcon } from '../../components/brand/BrandIcon';
import { ConnectionDetailLayout } from '../connections/ConnectionDetailLayout';
import { ConfirmDialog } from '../connections/ConfirmDialog';
import { ManagementFeedback, type Confirmation } from '../connections/ManagementFeedback';
import type { FlowTarget } from '../connections/IntegrationFlow';
import { nativeApi, type IntegrationEntry } from '../../ha/management';
import { AddHacsRepoDialog } from './AddHacsRepoDialog';
import { HacsCatalog } from './HacsCatalog';
import { HacsRepositoryDetails } from './HacsRepositoryDetails';
import {
  hacs,
  filterCommunity,
  formatHacsRepositoryError,
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
    [adding, setAdding] = useState(false);
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
      setError(formatHacsRepositoryError(reason));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const pendingUpgradeRepos = useMemo(
    () => repositories.filter((repo) => repo.pending_upgrade),
    [repositories],
  );
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
              'Operation completed. Integrations may need a runtime restart.',
            )
          }
        />
      )}
      {adding && (
        <AddHacsRepoDialog
          categories={info?.categories ?? ['integration', 'plugin', 'theme', 'template']}
          onClose={() => setAdding(false)}
          onAdded={async (added) => {
            await load();
            setSelected(added);
            setNotice(`Custom HACS repository ${added.name} added.`);
          }}
        />
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
        icon={
          <BrandIcon
            kind="integration"
            id="hacs"
            hint={{ name: 'HACS', repositoryUrl: 'hacs/integration' }}
          />
        }
        onBack={onBack}
        actions={
          <>
            {pendingUpgradeRepos.length > 0 && (
              <HausButton
                className="flow-next-pill"
                isDisabled={busy || loading}
                onPress={() =>
                  void perform(async () => {
                    for (const repo of pendingUpgradeRepos) {
                      await hacs('repository/download', { repository: String(repo.id) });
                    }
                  }, `Updated ${pendingUpgradeRepos.length} community integrations.`)
                }
              >
                <ArrowUpCircle size={15} />
                Update all ({pendingUpgradeRepos.length})
              </HausButton>
            )}
            <HausButton
              variant="secondary"
              isDisabled={busy || loading}
              onPress={() => setAdding(true)}
            >
              <Plus size={15} />
              Add source
            </HausButton>
            {entry?.supports_options && (
              <HausButton
                variant="ghost"
                onPress={() => onFlow({ domain: 'hacs', entryId: entry.entry_id, kind: 'options' })}
              >
                Settings
              </HausButton>
            )}
          </>
        }
      >
        {feedback}
        {loading && (
          <Text semantic="p" role="status" className="management-loading">
            Reading community catalog…
          </Text>
        )}
        {info?.disabled_reason && (
          <Text semantic="p" className="form-error">
            HACS needs attention: {info.disabled_reason}
          </Text>
        )}
        {critical
          .filter((item) => !item.acknowledged)
          .map((item) => (
            <Box semantic="article" className="integration-repair" key={item.repository}>
              <Box>
                <Heading level={3}>{item.repository}</Heading>
                <Text semantic="p">
                  {item.reason || 'HACS has reported an important issue with this repository.'}
                </Text>
              </Box>
              <HausButton
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
              </HausButton>
            </Box>
          ))}
        <Box className="management-toolbar">
          <Text semantic="label" className="management-search">
            <Search size={17} />
            <TextInput
              ariaLabel="Search community"
              placeholder="Find a community integration or resource"
              value={query}
              onChange={setQuery}
            />
          </Text>
          <SelectInput
            ariaLabel="Community category"
            value={category}
            options={[
              { value: 'all', label: 'Every type' },
              ...(info?.categories ?? []).map((value) => ({ value, label: value })),
            ]}
            onChange={setCategory}
          />
          <HausButton
            variant="ghost"
            isDisabled={busy || loading}
            onPress={() =>
              void perform(async () => {
                await nativeApi()
                  .request({ type: 'haus/updates/check' })
                  .catch(() => undefined);
              }, 'Catalog refreshed.')
            }
          >
            <RefreshCw size={16} />
          </HausButton>
        </Box>
        <Box className="filter-tabs">
          {['installed', 'updates', 'browse', 'hidden', 'removed'].map((value) => (
            <HausButton
              key={value}
              variant="ghost"
              aria-pressed={scope === value}
              onPress={() => setScope(value)}
            >
              {value === 'browse' ? 'Explore' : value[0].toUpperCase() + value.slice(1)}
              {value === 'updates' &&
                ` · ${repositories.filter((repo) => repo.pending_upgrade).length}`}
            </HausButton>
          ))}
        </Box>
        {scope === 'removed' ? (
          <Box>
            {removed.length ? (
              removed.map((item) => (
                <Box semantic="article" className="integration-repair" key={item.repository}>
                  <Box>
                    <Heading level={3}>{item.repository}</Heading>
                    <Text semantic="p">
                      {item.reason || 'This repository is no longer offered by HACS.'}
                    </Text>
                  </Box>
                </Box>
              ))
            ) : (
              <Text semantic="p" className="management-hint">
                No removed sources need attention.
              </Text>
            )}
          </Box>
        ) : (
          <>
            <Text semantic="p" className="management-hint">
              {filtered.length.toLocaleString()} {filtered.length === 1 ? 'resource' : 'resources'}
            </Text>
            {!!filtered.length && (
              <HacsCatalog
                repositories={filtered}
                busy={busy}
                onSelect={setSelected}
                onUpdate={(repo) =>
                  void perform(
                    () => hacs('repository/download', { repository: String(repo.id) }),
                    `Updated ${repo.name}.`,
                  )
                }
              />
            )}{' '}
            {!loading && !filtered.length && (
              <Box className="management-empty">
                <Heading level={3}>No matches</Heading>
                <Text semantic="p">Try another type or search term.</Text>
              </Box>
            )}
          </>
        )}
      </ConnectionDetailLayout>
      {dialogs}
    </>
  );
}
