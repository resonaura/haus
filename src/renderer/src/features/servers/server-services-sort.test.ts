import { describe, expect, it } from 'vitest';
import { sortServerServiceRows, type ServerServiceRow } from './server-services-sort';

const row = (id: string, changes: Partial<ServerServiceRow> = {}): ServerServiceRow => ({
  id,
  name: id,
  status: 'running',
  cpu: null,
  memory: null,
  extra: null,
  ...changes,
});

describe('server process table sorting', () => {
  it('sorts numeric metrics numerically and keeps unknown readings last in either direction', () => {
    const rows = [row('unknown', { cpu: null }), row('ten', { cpu: 10 }), row('two', { cpu: 2 })];
    expect(sortServerServiceRows(rows, 'cpu', 'ascending').map((item) => item.id)).toEqual([
      'two',
      'ten',
      'unknown',
    ]);
    expect(sortServerServiceRows(rows, 'cpu', 'descending').map((item) => item.id)).toEqual([
      'ten',
      'two',
      'unknown',
    ]);
  });

  it('uses stable IDs to order ties when live samples update', () => {
    const rows = [
      row('service-10', { name: 'Haus', memory: 1024 }),
      row('service-2', { name: 'Haus', memory: 1024 }),
    ];
    expect(sortServerServiceRows(rows, 'name', 'ascending').map((item) => item.id)).toEqual([
      'service-2',
      'service-10',
    ]);
  });

  it('sorts mixed numeric and text extra columns naturally', () => {
    const rows = [row('worker-10', { extra: 'worker-10' }), row('worker-2', { extra: 'worker-2' })];
    expect(sortServerServiceRows(rows, 'extra', 'ascending').map((item) => item.id)).toEqual([
      'worker-2',
      'worker-10',
    ]);
  });
});
