/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useEffect, useState } from 'react';
import { RecorderTrend, UiIcon } from '@haus/ui/components';
import type { TrendPoint } from '@haus/ui/components';
import {
  HausButton,
  HausSegmentedControl,
  Heading,
  Row,
  Stack,
  Text,
  TextInput,
} from '@haus/ui/primitives';
import { colorToken, corners, insets, px, SolidMaterial } from '@haus/ui/ir';
import { isRecord } from '../../main/hub/types.js';

const ranges = [
  { value: 'day', label: '24 hours', days: 1, period: 'hour' },
  { value: 'week', label: '7 days', days: 7, period: 'hour' },
  { value: 'month', label: '30 days', days: 30, period: 'day' },
  { value: 'year', label: '12 months', days: 365, period: 'month' },
] as const;

interface Statistic {
  id: string;
  label: string;
  unit?: string;
  metric: 'mean' | 'sum' | 'state';
}

export type StatisticsRequest = (message: Record<string, unknown>) => Promise<unknown>;

function statistics(payload: unknown): Statistic[] {
  if (!Array.isArray(payload)) return [];
  return payload
    .flatMap((item): Statistic[] => {
      if (!isRecord(item) || typeof item.statistic_id !== 'string') return [];
      return [
        {
          id: item.statistic_id,
          label: typeof item.name === 'string' && item.name ? item.name : item.statistic_id,
          unit: typeof item.unit_of_measurement === 'string' ? item.unit_of_measurement : undefined,
          metric: item.has_mean === true ? 'mean' : item.has_sum === true ? 'sum' : 'state',
        },
      ];
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

function trend(payload: unknown, sensor: Statistic): TrendPoint[] {
  const rows = isRecord(payload) ? payload[sensor.id] : undefined;
  if (!Array.isArray(rows)) return [];
  return rows.slice(-2000).flatMap((row): TrendPoint[] => {
    if (!isRecord(row) || typeof row.start !== 'number' || !Number.isFinite(row.start)) return [];
    const value = row[sensor.metric];
    return typeof value === 'number' && Number.isFinite(value) ? [{ time: row.start, value }] : [];
  });
}

export function Statistics({ request }: { request?: StatisticsRequest }) {
  const [available, setAvailable] = useState<Statistic[]>([]);
  const [selected, setSelected] = useState<Statistic>();
  const [points, setPoints] = useState<TrendPoint[]>([]);
  const [range, setRange] = useState<(typeof ranges)[number]['value']>('week');
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(Boolean(request));
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!request) return;
    let active = true;
    setLoading(true);
    setError('');
    void request({ type: 'recorder/list_statistic_ids' })
      .then(
        (result) => {
          if (!active) return;
          const list = statistics(result);
          setAvailable(list);
          setSelected((previous) => list.find((item) => item.id === previous?.id) ?? list[0]);
        },
        () => {
          if (active) setError('Could not load recorded sensors.');
        },
      )
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [request, refresh]);

  useEffect(() => {
    if (!request || !selected) return;
    let active = true;
    const period = ranges.find((option) => option.value === range) ?? ranges[1];
    setPoints([]);
    setLoading(true);
    setError('');
    void request({
      type: 'recorder/statistics_during_period',
      start_time: new Date(Date.now() - period.days * 86_400_000).toISOString(),
      statistic_ids: [selected.id],
      period: period.period,
    })
      .then(
        (result) => {
          if (active) setPoints(trend(result, selected));
        },
        () => {
          if (active) setError('Could not load recorded values.');
        },
      )
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [request, selected, range]);

  if (!request)
    return (
      <Stack gapPx={7}>
        <UiIcon name="activity" size={22} />
        <Heading level={2}>Recorded sensor history</Heading>
        <Text tone="muted">Connect your Haus Hub to browse recorded sensor statistics.</Text>
      </Stack>
    );
  const filtered = available.filter((item) =>
    `${item.label} ${item.id}`.toLowerCase().includes(filter.trim().toLowerCase()),
  );
  const latest = points.at(-1);

  return (
    <Stack gapPx={15}>
      <Row gapPx={18} wrap>
        <Text size={12} tone="muted">{`${available.length} tracked statistics`}</Text>
        <Text size={12} tone="muted">{`${points.length} points in this view`}</Text>
        {latest && <Text size={12}>{`${latest.value} ${selected?.unit ?? ''}`}</Text>}
      </Row>
      <Row align="start" gapPx={15} wrap>
        <Stack
          gapPx={8}
          style={{ layout: { width: px(186), maxHeight: px(420), overflowY: 'scroll' } }}
        >
          <Text size={13} weight={600}>
            Recorded sensors
          </Text>
          <TextInput
            id="statistic-search"
            ariaLabel="Find a statistic"
            value={filter}
            placeholder="Find a statistic"
            onChange={setFilter}
            style={{
              layout: { padding: insets(6, 9), minHeight: px(35) },
              material: new SolidMaterial(colorToken('soft')),
            }}
          />
          {filtered.map((item) => (
            <HausButton
              key={item.id}
              size="sm"
              variant={selected?.id === item.id ? 'secondary' : 'ghost'}
              onPress={() => setSelected(item)}
            >
              <Text size={12}>{item.label}</Text>
            </HausButton>
          ))}
        </Stack>
        <Stack
          gapPx={14}
          style={{
            layout: { flexGrow: 1, minWidth: px(240), padding: insets(14) },
            corners: corners(15),
            material: new SolidMaterial(colorToken('card')),
          }}
        >
          <Heading level={2}>{selected?.label ?? 'Statistics'}</Heading>
          <HausSegmentedControl
            id="statistic-range"
            aria-label="History range"
            value={range}
            options={ranges}
            onChange={setRange}
          />
          {error ? (
            <Row gapPx={8}>
              <Text tone="critical" role="alert">
                {error}
              </Text>
              <HausButton onPress={() => setRefresh((v) => v + 1)}>Retry</HausButton>
            </Row>
          ) : loading ? (
            <Text tone="muted" role="status">
              Loading recorded values…
            </Text>
          ) : points.length ? (
            <RecorderTrend
              points={points}
              label="Recorded values"
              compactDates={range === 'day' || range === 'week'}
              portable
            />
          ) : (
            <Text tone="muted">No recorded values for this period.</Text>
          )}
          <Text tone="muted" size={10}>
            Recorded locally by your home
          </Text>
        </Stack>
      </Row>
    </Stack>
  );
}
