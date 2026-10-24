export type ServerServiceSortKey = 'name' | 'status' | 'cpu' | 'memory' | 'extra';
export type ServerServiceSortDirection = 'ascending' | 'descending';

export interface ServerServiceRow {
  id: string;
  name: string;
  status: string;
  cpu: number | null;
  memory: number | null;
  extra: string | number | null;
}

function compare(a: string | number, b: string | number) {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

/** Null readings always stay last; ties fall back to the persistent ID. */
export function sortServerServiceRows<T extends ServerServiceRow>(
  rows: T[],
  key: ServerServiceSortKey,
  direction: ServerServiceSortDirection,
) {
  const multiplier = direction === 'ascending' ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, value: row[key] }))
    .sort((a, b) => {
      if (a.value === null && b.value !== null) return 1;
      if (b.value === null && a.value !== null) return -1;
      if (a.value === null && b.value === null) return a.index - b.index;
      const order = compare(a.value!, b.value!);
      return order
        ? order * multiplier
        : a.row.id.localeCompare(b.row.id, undefined, { numeric: true });
    })
    .map(({ row }) => row);
}
