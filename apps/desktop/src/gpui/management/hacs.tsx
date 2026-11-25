/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildDemoHacsState,
  communityRepositoryName,
  filterCommunity,
  formatHacsRepositoryError,
  type CommunityRepository,
  type CriticalRepository,
  type HacsInfo,
  type HacsReleaseNote,
  type HacsReleaseTag,
  type HacsScope,
  type RemovedRepository,
} from '@haus/core/transport';
import {
  AddHacsRepositoryModal,
  HacsCommunityView,
  HacsConfirmDialog,
  HacsRepositoryDetailsView,
  type HacsConfirmation,
} from '@haus/ui/components';
import { pct } from '@haus/ui/ir';
import { Box } from '@haus/ui/primitives';
import type { GpuiAddDeviceRequest } from './add-device.js';
import {
  applyDemoDownload,
  applyDemoRemoveDownload,
  buildDemoCustomRepository,
} from './hacs-demo.js';
import type { GpuiRpcRequest } from './integrations.js';

export interface GpuiHacsEntryInfo {
  readonly entry_id: string;
  readonly supports_options?: boolean;
}

export function GpuiHacsView({
  demo,
  hacsEntry,
  requestRpc,
  onAddDevice,
  openExternal,
  onBack,
  onSaved,
}: {
  readonly demo?: boolean;
  readonly hacsEntry?: GpuiHacsEntryInfo;
  readonly requestRpc?: GpuiRpcRequest;
  readonly onAddDevice?: (request?: GpuiAddDeviceRequest) => void;
  readonly openExternal?: (url: string) => Promise<void>;
  readonly onBack: () => void;
  readonly onSaved?: () => void;
}) {
  const demoInitial = useMemo(() => (demo ? buildDemoHacsState() : undefined), [demo]);
  const pendingRef = useRef(false);
  const mountedRef = useRef(true);

  const [info, setInfo] = useState<HacsInfo | undefined>(() => demoInitial?.info);
  const [repositories, setRepositories] = useState<readonly CommunityRepository[]>(
    () => demoInitial?.repositories ?? [],
  );
  const [critical, setCritical] = useState<readonly CriticalRepository[]>(
    () => demoInitial?.critical ?? [],
  );
  const [removed, setRemoved] = useState<readonly RemovedRepository[]>(
    () => demoInitial?.removed ?? [],
  );
  const [demoReleases, setDemoReleases] = useState<
    Readonly<Record<string, readonly HacsReleaseTag[]>>
  >(() => demoInitial?.releasesById ?? {});
  const [demoNotes, setDemoNotes] = useState<Readonly<Record<string, readonly HacsReleaseNote[]>>>(
    () => demoInitial?.notesById ?? {},
  );

  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<HacsScope>('installed');
  const [category, setCategory] = useState('all');
  const [loading, setLoading] = useState(Boolean(!demo));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [addingOpen, setAddingOpen] = useState(false);
  const [addError, setAddError] = useState('');
  const [confirmation, setConfirmation] = useState<HacsConfirmation | null>(null);

  const [selectedId, setSelectedId] = useState<string>();
  const [detailsRepo, setDetailsRepo] = useState<CommunityRepository>();
  const [detailsReleases, setDetailsReleases] = useState<readonly HacsReleaseTag[]>([]);
  const [detailsNotes, setDetailsNotes] = useState<readonly HacsReleaseNote[]>([]);
  const [selectedVersion, setSelectedVersion] = useState('');
  const [detailsReading, setDetailsReading] = useState(false);
  const [detailsError, setDetailsError] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (demo) {
      setLoading(false);
      return;
    }
    if (!requestRpc) {
      setError('Connect to a Home Hub to manage community extensions.');
      setLoading(false);
      return;
    }
    const [status, list, alerts, retired] = await Promise.all([
      requestRpc<HacsInfo>({ type: 'hacs/info' }),
      requestRpc<CommunityRepository[]>({ type: 'hacs/repositories/list' }),
      requestRpc<CriticalRepository[]>({ type: 'hacs/critical/list' }),
      requestRpc<RemovedRepository[]>({ type: 'hacs/repositories/removed' }),
    ]);
    if (!mountedRef.current) return;
    setInfo(status);
    setRepositories(Array.isArray(list) ? list : []);
    setCritical(Array.isArray(alerts) ? alerts : []);
    setRemoved(Array.isArray(retired) ? retired : []);
    setRevision((value) => value + 1);
  }, [demo, requestRpc]);

  useEffect(() => {
    if (demo) return;
    let active = true;
    setLoading(true);
    setError('');
    void load()
      .catch((reason: unknown) => {
        if (active) setError(formatHacsRepositoryError(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [demo, load]);

  const activeRepo = useMemo(
    () =>
      selectedId === undefined
        ? undefined
        : (repositories.find((item) => String(item.id) === selectedId) ?? detailsRepo),
    [detailsRepo, repositories, selectedId],
  );

  useEffect(() => {
    if (selectedId === undefined) return;
    const base = repositories.find((item) => String(item.id) === selectedId);
    if (!base) return;
    if (demo) {
      setDetailsRepo(base);
      setDetailsReleases(demoReleases[selectedId] ?? []);
      setDetailsNotes(demoNotes[selectedId] ?? []);
      setSelectedVersion(
        base.selected_tag ?? base.available_version ?? base.installed_version ?? '',
      );
      setDetailsReading(false);
      setDetailsError('');
      return;
    }
    if (!requestRpc) return;
    let active = true;
    setDetailsRepo(base);
    setDetailsReading(true);
    setDetailsError('');
    void requestRpc<CommunityRepository>({
      type: 'hacs/repository/info',
      repository_id: selectedId,
    })
      .then((fetched) => {
        if (!active) return;
        const merged = { ...base, ...fetched };
        setDetailsRepo(merged);
        setSelectedVersion(merged.selected_tag ?? merged.available_version ?? '');
        void Promise.all([
          requestRpc<HacsReleaseTag[]>({
            type: 'hacs/repository/releases',
            repository_id: selectedId,
          }).catch(() => []),
          requestRpc<HacsReleaseNote[]>({
            type: 'hacs/repository/release_notes',
            repository: selectedId,
          }).catch(() => []),
        ]).then(([tags, notes]) => {
          if (!active) return;
          setDetailsReleases(Array.isArray(tags) ? tags : []);
          setDetailsNotes(Array.isArray(notes) ? notes : []);
        });
      })
      .catch((reason: unknown) => {
        if (active) setDetailsError(formatHacsRepositoryError(reason));
      })
      .finally(() => {
        if (active) setDetailsReading(false);
      });
    return () => {
      active = false;
    };
  }, [demo, demoNotes, demoReleases, repositories, requestRpc, revision, selectedId]);

  const perform = async (operation: () => Promise<unknown>, success = 'Changes saved.') => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    setConfirmation(null);
    try {
      await operation();
      if (!demo) await load();
      onSaved?.();
      if (mountedRef.current) setNotice(success);
    } catch (reason: unknown) {
      if (mountedRef.current) setError(formatHacsRepositoryError(reason));
    } finally {
      pendingRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  };

  const pendingUpgrades = useMemo(
    () => repositories.filter((repo) => repo.pending_upgrade),
    [repositories],
  );
  const filtered = useMemo(
    () => filterCommunity(repositories, query, scope, category),
    [category, query, repositories, scope],
  );

  const downloadRepo = (repo: CommunityRepository, version?: string) => {
    const id = String(repo.id);
    if (demo) {
      const nextVersion = version || repo.available_version || repo.installed_version || 'v1.0.0';
      setRepositories((prev) => applyDemoDownload(prev, id, nextVersion));
      return Promise.resolve();
    }
    if (!requestRpc) return Promise.resolve();
    return requestRpc({
      type: 'hacs/repository/download',
      repository: id,
      ...(version ? { version } : {}),
    });
  };

  const handleAddRepository = async (source: string, chosenCategory: string) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setBusy(true);
    setAddError('');
    try {
      const repository = communityRepositoryName(source);
      let added: CommunityRepository;
      if (demo) {
        if (
          repositories.some((item) => item.full_name.toLowerCase() === repository.toLowerCase())
        ) {
          throw new Error(`hacs_repository_exists:${repository}`);
        }
        added = buildDemoCustomRepository(repository, chosenCategory);
        setRepositories((prev) => [...prev, added]);
        setDemoReleases((prev) => ({
          ...prev,
          [String(added.id)]: [{ tag: 'v1.0.0', name: 'v1.0.0' }],
        }));
        setDemoNotes((prev) => ({ ...prev, [String(added.id)]: [] }));
      } else {
        if (!requestRpc) throw new Error('Connect to a Home Hub first.');
        added = await requestRpc<CommunityRepository>({
          type: 'hacs/repositories/add',
          repository,
          category: chosenCategory,
        });
        await load();
      }
      onSaved?.();
      if (mountedRef.current) {
        setAddingOpen(false);
        setSelectedId(String(added.id));
        setNotice(`Custom HACS repository ${added.name} added.`);
      }
    } catch (reason: unknown) {
      if (mountedRef.current) setAddError(formatHacsRepositoryError(reason));
    } finally {
      pendingRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  };

  const dialogs = (
    <>
      {confirmation && (
        <HacsConfirmDialog
          confirmation={confirmation}
          busy={busy}
          onClose={() => setConfirmation(null)}
          onConfirm={() =>
            void perform(
              confirmation.action,
              'Operation completed. Integrations may need a runtime restart.',
            )
          }
        />
      )}
      {addingOpen && (
        <AddHacsRepositoryModal
          categories={info?.categories}
          busy={busy}
          error={addError || undefined}
          onClose={() => {
            setAddError('');
            setAddingOpen(false);
          }}
          onSubmit={(source, chosen) => void handleAddRepository(source, chosen)}
        />
      )}
    </>
  );

  if (activeRepo) {
    const id = String(activeRepo.id);
    return (
      <Box style={{ layout: { width: pct(100) } }}>
        <HacsRepositoryDetailsView
          repository={activeRepo}
          releases={detailsReleases}
          notes={detailsNotes}
          selectedVersion={selectedVersion}
          reading={detailsReading}
          busy={busy}
          error={detailsError || error || undefined}
          onSelectVersion={setSelectedVersion}
          onToggleBeta={(showBeta) =>
            void perform(async () => {
              if (demo) {
                setRepositories((prev) =>
                  prev.map((item) => (String(item.id) === id ? { ...item, beta: showBeta } : item)),
                );
                return;
              }
              await requestRpc?.({
                type: 'hacs/repository/beta',
                repository: id,
                show_beta: showBeta,
              });
            })
          }
          onDownload={() =>
            setConfirmation({
              title: `${activeRepo.installed ? 'Download' : 'Install'} ${activeRepo.name}?`,
              label: activeRepo.installed ? 'Download version' : 'Install',
              description: `${selectedVersion || activeRepo.available_version || 'The selected version'} will be downloaded to your home server. Integrations may need a runtime restart.`,
              action: () => downloadRepo(activeRepo, selectedVersion || undefined),
            })
          }
          onSetupIntegration={
            onAddDevice ? (domain) => onAddDevice({ mode: 'flow', target: { domain } }) : undefined
          }
          onRefresh={() =>
            void perform(async () => {
              if (!demo) await requestRpc?.({ type: 'hacs/repository/refresh', repository: id });
            }, 'Repository refreshed.')
          }
          onOpenSource={
            openExternal
              ? (url) =>
                  void openExternal(url).catch((err: unknown) =>
                    setDetailsError(formatHacsRepositoryError(err)),
                  )
              : undefined
          }
          onRemoveDownload={() =>
            setConfirmation({
              title: `Remove ${activeRepo.name}?`,
              label: 'Remove download',
              danger: true,
              description:
                'Downloaded files will be removed. Devices using this integration may become unavailable until it is installed again.',
              action: async () => {
                if (demo) {
                  setRepositories((prev) => applyDemoRemoveDownload(prev, id));
                  return;
                }
                await requestRpc?.({ type: 'hacs/repository/remove', repository: id });
              },
            })
          }
          onRemoveCustom={() =>
            setConfirmation({
              title: 'Remove custom repository?',
              label: 'Remove repository',
              danger: true,
              description: 'This source will be removed from your community catalog.',
              action: async () => {
                if (demo) {
                  setRepositories((prev) => prev.filter((item) => String(item.id) !== id));
                  setSelectedId(undefined);
                  setDetailsRepo(undefined);
                  return;
                }
                await requestRpc?.({ type: 'hacs/repositories/remove', repository: id });
                setSelectedId(undefined);
                setDetailsRepo(undefined);
              },
            })
          }
          onBack={() => {
            setSelectedId(undefined);
            setDetailsRepo(undefined);
          }}
        />
        {dialogs}
      </Box>
    );
  }

  return (
    <Box style={{ layout: { width: pct(100) } }}>
      <HacsCommunityView
        info={info}
        repositories={repositories}
        filtered={filtered}
        critical={critical}
        removed={removed}
        query={query}
        scope={scope}
        category={category}
        loading={loading}
        busy={busy}
        error={error || undefined}
        notice={notice || undefined}
        onBack={onBack}
        onQueryChange={setQuery}
        onScopeChange={setScope}
        onCategoryChange={setCategory}
        onRefresh={() =>
          void perform(async () => {
            if (!demo) {
              await requestRpc?.({ type: 'haus/updates/check' }).catch(() => undefined);
            }
          }, 'Catalog refreshed.')
        }
        onOpenAdd={() => {
          setAddError('');
          setAddingOpen(true);
        }}
        onOpenSettings={
          hacsEntry?.supports_options && onAddDevice
            ? () =>
                onAddDevice({
                  mode: 'flow',
                  target: { domain: 'hacs', entryId: hacsEntry.entry_id, kind: 'options' },
                })
            : undefined
        }
        onUpdateAll={() =>
          void perform(async () => {
            for (const repo of pendingUpgrades) {
              await downloadRepo(repo);
            }
          }, `Updated ${pendingUpgrades.length} community integrations.`)
        }
        onUpdateRepo={(repo) => void perform(() => downloadRepo(repo), `Updated ${repo.name}.`)}
        onSelectRepo={(repo) => setSelectedId(String(repo.id))}
        onAcknowledgeCritical={(item) =>
          setConfirmation({
            title: 'Acknowledge repository warning?',
            label: 'Acknowledge',
            description:
              'This dismisses the warning after you have reviewed it. It does not repair or reinstall the repository.',
            action: async () => {
              if (demo) {
                setCritical((prev) =>
                  prev.map((entry) =>
                    entry.repository === item.repository ? { ...entry, acknowledged: true } : entry,
                  ),
                );
                return;
              }
              await requestRpc?.({
                type: 'hacs/critical/acknowledge',
                repository: item.repository,
              });
            },
          })
        }
      />
      {dialogs}
    </Box>
  );
}
