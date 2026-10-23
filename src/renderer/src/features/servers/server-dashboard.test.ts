import { describe, expect, it } from 'vitest';
import { diskSummary, serviceSummary } from './server-dashboard';
import type { ServerDisk, ServerHost } from './types';

const disk = (id: string, changes: Partial<ServerDisk> = {}): ServerDisk => ({
  id,
  name: id,
  kind: 'disk',
  type: 'disk',
  physical: true,
  parentId: null,
  mountpoint: null,
  filesystem: null,
  totalBytes: 1000,
  usedBytes: null,
  availableBytes: null,
  scope: 'host',
  ...changes,
});

describe('server dashboard aggregates', () => {
  it('counts whole devices once and never adds their partition/container/volume capacities', () => {
    const disks = [
      disk('a'),
      disk('b', { totalBytes: 2000 }),
      disk('partition', { parentId: 'a', kind: 'volume', type: 'partition', physical: false }),
      disk('shared-container', {
        parentId: 'partition',
        parentIds: ['partition', 'b'],
        kind: 'volume',
        type: 'container',
        physical: false,
      }),
      disk('volume', {
        parentId: 'shared-container',
        kind: 'volume',
        type: 'volume',
        mountpoint: '/',
        totalBytes: 3000,
        usedBytes: 1200,
        availableBytes: 1800,
        physical: false,
      }),
    ];
    const result = diskSummary([...disks, disks[0]]);
    expect(result.deviceCount).toBe(2);
    expect(result.capacityBytes).toBe(3000);
    expect(result.usedBytes).toBeNull();
    expect(result.largestMounted?.id).toBe('volume');
  });
  it('preserves unknown capacity and refuses to combine orphan volumes with unknown backing stores', () => {
    expect(diskSummary([disk('a'), disk('b', { totalBytes: null })]).capacityBytes).toBeNull();
    const summary = diskSummary([
      disk('root', { kind: 'volume', type: 'volume', physical: false }),
      disk('data', { kind: 'volume', type: 'volume', physical: false }),
    ]);
    expect(summary.capacityBytes).toBeNull();
    expect(summary.separateVolumes).toBe(true);
    expect(
      diskSummary([disk('a', { parentId: 'b' }), disk('b', { parentId: 'a' })]).capacityBytes,
    ).toBeNull();
  });
  it('keeps unreported services distinct from empty ones and flags actual error states', () => {
    expect(serviceSummary(null)).toEqual({ docker: null, pm2: null });
    const host = {
      docker: {
        available: true,
        containers: [
          { state: 'running', status: 'Up (healthy)' },
          { state: 'running', status: 'Up (unhealthy)' },
          { state: 'exited', status: 'Exited' },
        ],
      },
      pm2: {
        available: true,
        processes: [{ status: 'online' }, { status: 'stopped' }, { status: 'errored' }],
      },
    } as ServerHost;
    expect(serviceSummary(host)).toEqual({
      docker: { total: 3, active: 2, attention: 1 },
      pm2: { total: 3, active: 1, attention: 1 },
    });
    expect(serviceSummary({ ...host, docker: { ...host.docker, containers: [] } }).docker).toEqual({
      total: 0,
      active: 0,
      attention: 0,
    });
  });
});
