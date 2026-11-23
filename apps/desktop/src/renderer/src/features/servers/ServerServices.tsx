/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Boxes, FileText, Settings2, TerminalSquare } from 'lucide-react';
import { Box, HausButton, HausScrollArea, Heading, Pressable, px, Text } from '@haus/ui';
import { bytes, serviceSampleIsFresh, uptime } from './presentation';
import type { ServerHost } from './types';
import { isServiceRunning, serviceActivity, type ServiceKind } from './service-activity';
import {
  normalizeServiceCpu,
  serviceCpuBasis,
  serviceCpuPercent,
  serviceUsageScore,
} from './service-usage-score';
import { ServiceUsage, ServiceUsageGauge } from './ServiceUsage';
import { ServiceManagerIcon } from './ServiceManagerIcon';
import {
  sortServerServiceRows,
  type ServerServiceRow,
  type ServerServiceSortKey,
} from './server-services-sort';
import { ServiceConsoleDialog, type ActiveServiceConsole } from './terminal/service-dialog';

interface DisplayServiceRow extends ServerServiceRow {
  rawId: string;
  manager: ServiceKind;
  running: boolean;
  subtitle: string;
  statusDetail: string;
  trailing: string;
}

export function ServerServices({
  host,
  lastKnown = false,
  now = Date.now(),
  serverId,
  admin = false,
}: {
  host: ServerHost;
  lastKnown?: boolean;
  now?: number;
  serverId?: string;
  admin?: boolean;
}) {
  const [selectedTab, setTab] = useState<ServiceKind | 'all'>('all');
  const [activeConsole, setActiveConsole] = useState<ActiveServiceConsole>();
  const canInspect = Boolean(serverId && admin);
  const managerOrder: ServiceKind[] = ['docker', 'pm2', 'systemServices'];
  const groups = serviceActivity(host, !lastKnown, now).sort(
    (a, b) => managerOrder.indexOf(a.id) - managerOrder.indexOf(b.id),
  );
  const tab =
    selectedTab === 'all' || !groups.some((group) => group.id === selectedTab)
      ? 'all'
      : selectedTab;
  const groupedPm2Services =
    host.pm2.available && host.pm2.processes.length > 0
      ? (host.systemServices?.services ?? []).filter((item) =>
          /^pm2(?:-[\w.-]+)?\.service$/.test(item.id.replace(/^(windows|wsl):/, '')),
        )
      : [];
  const groupedPm2Ids = new Set(groupedPm2Services.map((item) => item.id));
  const all = {
    id: 'all' as const,
    name: 'All',
    source: 'host',
    active:
      groups.reduce((sum, group) => sum + group.active, 0) -
      groupedPm2Services.filter((item) => isServiceRunning(item.status)).length,
    total: groups.reduce((sum, group) => sum + group.total, 0) - groupedPm2Ids.size,
    cpu: !lastKnown && host.cpu.usage !== null ? host.cpu.usage * 100 : null,
    memory: !lastKnown ? host.memory.usedBytes : null,
    cpuIncomplete: false,
    memoryIncomplete: false,
  };
  const selectedGroup = tab === 'all' ? all : groups.find((group) => group.id === tab);
  const [page, setPage] = useState({ tab: '', limit: 24 });
  const scroller = useRef<HTMLDivElement>(null);
  const tableHeading = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLTableSectionElement>(null);
  const previousRows = useRef(new Map<string, number>());
  const [sort, setSort] = useState<{
    key: ServerServiceSortKey;
    direction: 'ascending' | 'descending';
  }>({ key: 'usage', direction: 'descending' });
  useLayoutEffect(() => {
    scroller.current?.scrollTo({ top: 0, behavior: 'instant' });
  }, [tab, sort.key, sort.direction]);
  const count = selectedGroup?.total ?? 0;
  const managerRows = (kind: ServiceKind): DisplayServiceRow[] =>
    kind === 'docker'
      ? host.docker.containers.map((item) => {
          const sampleFresh = !lastKnown && serviceSampleIsFresh(item.sampledAt, now);
          return {
            id: item.id,
            rawId: item.id,
            manager: kind,
            running: isServiceRunning(item.state),
            name: item.name,
            status: item.state,
            cpu: sampleFresh
              ? normalizeServiceCpu(
                  item.cpuPercent,
                  serviceCpuBasis(host, 'docker'),
                  host.cpu.logicalCores,
                )
              : null,
            memory: sampleFresh ? item.memoryUsedBytes : null,
            extra: item.image || 'Unavailable',
            subtitle: item.id.slice(0, 12),
            statusDetail: item.status,
            trailing: item.image || 'Unavailable',
          };
        })
      : kind === 'pm2'
        ? host.pm2.processes.map((item) => ({
            id: String(item.id),
            rawId: item.name || String(item.id),
            manager: kind,
            running: isServiceRunning(item.status),
            name: item.name,
            status: item.status,
            cpu: lastKnown
              ? null
              : normalizeServiceCpu(
                  item.cpuPercent,
                  serviceCpuBasis(host, 'pm2'),
                  host.cpu.logicalCores,
                ),
            memory: lastKnown ? null : item.memoryBytes,
            extra: item.uptimeSeconds,
            subtitle: `PID ${item.pid ?? '—'} · ${item.restarts ?? '—'} restarts`,
            statusDetail: '',
            trailing: uptime(item.uptimeSeconds),
          }))
        : (host.systemServices?.services ?? []).map((item) => {
            const sampleFresh =
              !lastKnown && serviceSampleIsFresh(host.systemServices?.sampledAt, now);
            return {
              id: item.id,
              rawId: item.id,
              manager: kind,
              running: isServiceRunning(item.status),
              name: item.name,
              status: item.status,
              cpu: sampleFresh
                ? normalizeServiceCpu(
                    item.cpuPercent,
                    serviceCpuBasis(host, 'systemServices'),
                    host.cpu.logicalCores,
                  )
                : null,
              memory: sampleFresh ? item.memoryBytes : null,
              extra: item.uptimeSeconds,
              subtitle: [
                item.domain === 'wsl' ? 'WSL' : item.domain === 'windows' ? 'Windows' : '',
                item.id !== item.name ? item.id.replace(/^(windows|wsl):/, '') : '',
                item.pid ? `PID ${item.pid}` : '',
                item.sharedProcess ? 'Shared process' : '',
              ]
                .filter(Boolean)
                .join(' · '),
              statusDetail: item.detail ?? '',
              trailing: item.uptimeSeconds === null ? '—' : uptime(item.uptimeSeconds),
            };
          });
  const rows =
    tab === 'all'
      ? groups.flatMap((group) =>
          managerRows(group.id)
            .filter((item) => group.id !== 'systemServices' || !groupedPm2Ids.has(item.id))
            .map((item) => ({
              ...item,
              id: `${group.id}:${item.id}`,
              extra: group.name,
              trailing: group.name,
            })),
        )
      : managerRows(tab);
  const sortedRows = sortServerServiceRows(
    rows.map((item) => ({
      ...item,
      usage: serviceUsageScore(item.cpu, item.memory, host.memory.totalBytes),
    })),
    sort.key,
    sort.direction,
  );
  const limit = page.tab === tab ? page.limit : 24;
  const hasMore = limit < sortedRows.length;
  const maybeLoadMore = () => {
    const node = scroller.current;
    if (node && tableHeading.current) {
      tableHeading.current.scrollLeft = node.scrollLeft;
      tableHeading.current.style.setProperty(
        '--service-scrollbar-width',
        `${node.offsetWidth - node.clientWidth}px`,
      );
    }
    if (
      hasMore &&
      node &&
      node.clientHeight > 0 &&
      node.scrollHeight - node.scrollTop - node.clientHeight < 240
    )
      setPage((current) => ({
        tab,
        limit: Math.min(sortedRows.length, (current.tab === tab ? current.limit : 24) + 24),
      }));
  };
  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const resize = new ResizeObserver(maybeLoadMore);
    resize.observe(node);
    maybeLoadMore();
    return () => resize.disconnect();
  }, [tab, hasMore, limit, sortedRows.length]);
  useLayoutEffect(() => {
    const node = body.current;
    if (!node) return;
    const next = new Map<string, number>();
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (const row of node.querySelectorAll<HTMLTableRowElement>('tr[data-service-id]')) {
      const id = row.dataset.serviceId!;
      const y = row.offsetTop;
      next.set(id, y);
      const old = previousRows.current.get(id);
      if (!reduced && old !== undefined && old !== y) {
        row.getAnimations().forEach((animation) => animation.cancel());
        row.animate([{ transform: `translateY(${old - y}px)` }, { transform: 'translateY(0)' }], {
          duration: 240,
          easing: 'cubic-bezier(.2,.8,.2,1)',
        });
      }
    }
    previousRows.current = next;
  });
  useEffect(() => {
    const target = sentinel.current;
    if (!target || !hasMore) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting)
          setPage((current) => ({
            tab: tab ?? '',
            limit: (current.tab === tab ? current.limit : 24) + 24,
          }));
      },
      { root: scroller.current, rootMargin: '0px 0px 240px 0px' },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [tab, hasMore, limit]);
  const sortHeader = (key: ServerServiceSortKey, label: string) => (
    <Box semantic="th" ariaSort={sort.key === key ? sort.direction : 'none'}>
      <Pressable
        className="server-sort-button"
        onPress={() => {
          scroller.current?.scrollTo({ top: 0, behavior: 'instant' });
          setSort((current) => ({
            key,
            direction:
              current.key === key
                ? current.direction === 'ascending'
                  ? 'descending'
                  : 'ascending'
                : key === 'usage' || key === 'cpu' || key === 'memory'
                  ? 'descending'
                  : 'ascending',
          }));
        }}
      >
        {label}
        {sort.key === key &&
          (sort.direction === 'ascending' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
      </Pressable>
    </Box>
  );
  const colWidths = [70, 0, 130, 86, 116, 150, ...(canInspect ? [78] : [])];
  const renderColGroup = () => (
    <Box semantic="colgroup">
      {colWidths.map((w, idx) => (
        <Box key={idx} semantic="col" style={w > 0 ? { layout: { width: px(w) } } : undefined} />
      ))}
    </Box>
  );
  return (
    <Box semantic="section" className="server-services">
      <Box semantic="header" className="server-services-heading">
        <Box className="server-section-heading">
          <Heading level={3}>
            Services
            {lastKnown && (
              <Text semantic="small" className="server-last-known">
                Last known
              </Text>
            )}
          </Heading>
        </Box>
        <Box className="server-service-toolbar">
          {groups.length > 0 && (
            <Box className="server-service-tabs" ariaLabel="Service type">
              {[all, ...groups].map(({ id, name, total }) => (
                <HausButton
                  key={id}
                  variant={tab === id ? 'secondary' : 'ghost'}
                  aria-pressed={tab === id}
                  onPress={() => {
                    setTab(id);
                    setPage({ tab: id, limit: 24 });
                  }}
                >
                  {id === 'all' ? (
                    <Boxes className="server-service-manager-icon" size={16} />
                  ) : (
                    <ServiceManagerIcon kind={id} host={host} size={16} />
                  )}
                  {id === 'systemServices' ? 'System' : name} <Text>{total}</Text>
                </HausButton>
              ))}
            </Box>
          )}
          <ServiceUsage
            cpu={selectedGroup?.cpu ?? null}
            memory={selectedGroup?.memory ?? null}
            cpuIncomplete={selectedGroup?.cpuIncomplete}
            memoryIncomplete={selectedGroup?.memoryIncomplete}
            totalMemory={host.memory.totalBytes}
            system={tab === 'all'}
          />
        </Box>
      </Box>
      <Box className="server-panel server-services-content">
        {!count ? (
          <Box className="server-service-empty">
            <Settings2 size={26} />
            <Text semantic="p">
              {selectedGroup
                ? `No ${tab === 'docker' ? 'containers' : 'services'} are listed.`
                : 'No service managers have been reported by this server.'}
            </Text>
          </Box>
        ) : (
          <>
            <Box boxRef={tableHeading} className="server-service-table server-service-table-header">
              <Box semantic="table">
                {renderColGroup()}
                <Box semantic="thead">
                  <Box semantic="tr">
                    {sortHeader('usage', 'Usage')}
                    {sortHeader('name', 'Name')}
                    {sortHeader('status', 'Status')}
                    {sortHeader('cpu', 'CPU')}
                    {sortHeader('memory', 'Memory')}
                    {sortHeader(
                      'extra',
                      tab === 'all' ? 'Source' : tab === 'docker' ? 'Image' : 'Uptime',
                    )}
                    {canInspect && <Box semantic="th" ariaLabel="Actions" />}
                  </Box>
                </Box>
              </Box>
            </Box>
            <HausScrollArea
              ref={scroller}
              className="server-service-table server-service-scroll"
              orientation="vertical"
              size={32}
              onScroll={maybeLoadMore}
            >
              <Box semantic="table" ariaLabel="Service processes">
                {renderColGroup()}
                <Box semantic="tbody" boxRef={body}>
                  {sortedRows.slice(0, limit).map((item) => (
                    <Box
                      semantic="tr"
                      key={item.id}
                      dataAttrs={{ 'data-service-id': `${item.manager}:${item.id}` }}
                    >
                      <Box semantic="td">
                        <ServiceUsageGauge
                          cpu={item.cpu}
                          memory={item.memory}
                          totalMemory={host.memory.totalBytes}
                          inactive={item.manager === 'docker' && !item.running}
                        />
                      </Box>
                      <Box semantic="td">
                        <Text semantic="strong">{item.name}</Text>
                        <Text semantic="small">{item.subtitle}</Text>
                      </Box>
                      <Box semantic="td">
                        <Text
                          className={`server-process-status ${item.running ? 'is-running' : ''}`}
                        >
                          {item.status}
                        </Text>
                        {item.statusDetail && <Text semantic="small">{item.statusDetail}</Text>}
                      </Box>
                      <Box semantic="td">{serviceCpuPercent(item.cpu)}</Box>
                      <Box semantic="td">{item.memory === null ? '—' : bytes(item.memory)}</Box>
                      <Box
                        semantic="td"
                        title={typeof item.extra === 'string' ? item.extra : undefined}
                      >
                        {item.trailing}
                      </Box>
                      {canInspect && (
                        <Box semantic="td" className="server-service-actions">
                          <Pressable
                            title={`Live logs — ${item.name}`}
                            ariaLabel={`Live logs for ${item.name}`}
                            onPress={() =>
                              setActiveConsole({
                                title: `${item.name} · Logs`,
                                ...(item.manager === 'docker'
                                  ? { containerId: item.rawId, running: item.running }
                                  : {}),
                                target:
                                  item.manager === 'docker'
                                    ? { kind: 'docker-logs', containerId: item.rawId, tail: 500 }
                                    : {
                                        kind: 'service-logs',
                                        manager: item.manager === 'pm2' ? 'pm2' : 'systemd',
                                        serviceId: item.rawId,
                                        tail: 400,
                                      },
                              })
                            }
                          >
                            <FileText size={14} />
                          </Pressable>
                          {item.manager === 'docker' && (
                            <Pressable
                              disabled={!item.running}
                              title={
                                item.running
                                  ? `Open terminal — ${item.name}`
                                  : 'Container is stopped'
                              }
                              ariaLabel={`Open terminal in ${item.name}`}
                              onPress={() =>
                                setActiveConsole({
                                  title: `${item.name} · Terminal`,
                                  containerId: item.rawId,
                                  running: item.running,
                                  target: { kind: 'docker-exec', containerId: item.rawId },
                                })
                              }
                            >
                              <TerminalSquare size={14} />
                            </Pressable>
                          )}
                        </Box>
                      )}
                    </Box>
                  ))}
                </Box>
              </Box>
              {hasMore && (
                <Box boxRef={sentinel} className="server-service-page-sentinel" ariaHidden />
              )}
            </HausScrollArea>
          </>
        )}
        {selectedGroup && (
          <Box semantic="footer" className="server-service-load-summary">
            <Text>
              {selectedGroup.active} running · {selectedGroup.total} total
            </Text>
          </Box>
        )}
      </Box>
      {activeConsole && serverId && (
        <ServiceConsoleDialog
          serverId={serverId}
          consoleState={activeConsole}
          onChangeMode={setActiveConsole}
          onClose={() => setActiveConsole(undefined)}
        />
      )}
    </Box>
  );
}
