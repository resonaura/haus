/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useMemo, useState } from 'react';
import { Box, HausScrollArea, Heading, Pressable, Text, TextInput, VectorGraphic } from '@haus/ui';
import { Activity, Database, RefreshCw, Search, Waves } from 'lucide-react';
import { titleCase } from '../../model/presentation';
import type { HassEntity } from '../../model';

type StatisticMetadata = {
  statistic_id: string;
  name?: string | null;
  source?: string;
  unit_of_measurement?: string | null;
  mean_type?: number;
  has_mean?: boolean;
  has_sum?: boolean;
};

type StatisticPoint = {
  start: number | string;
  end?: number | string;
  mean?: number | string | null;
  min?: number | string | null;
  max?: number | string | null;
  state?: number | string | null;
  sum?: number | string | null;
  [key: string]: unknown;
};

type Metric = 'mean' | 'min' | 'max' | 'sum' | 'state';
type Range = 'day' | 'week' | 'month' | 'year';

const ranges: Array<{ id: Range; label: string; days: number; period: string }> = [
  { id: 'day', label: '24 hours', days: 1, period: 'hour' },
  { id: 'week', label: '7 days', days: 7, period: 'hour' },
  { id: 'month', label: '30 days', days: 30, period: 'day' },
  { id: 'year', label: '12 months', days: 365, period: 'month' },
];

const metricLabels: Record<Metric, string> = {
  mean: 'Mean',
  min: 'Minimum',
  max: 'Maximum',
  sum: 'Total',
  state: 'Value',
};

const numericValue = (value: unknown): number | null => {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (value === '') return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
};

const displayValue = (value: number, unit?: string | null) => {
  const maximumFractionDigits = Math.abs(value) < 1 && value !== 0 ? 3 : 2;
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(value)}${unit ? ` ${unit}` : ''}`;
};

const dateLabel = (timestamp: number, range: Range) => {
  const date = new Date(timestamp);
  return new Intl.DateTimeFormat(undefined, {
    ...(range === 'day' || range === 'week' ? { hour: 'numeric' } : { month: 'short' }),
    ...(range === 'day' || range === 'week' ? {} : { day: 'numeric' }),
  }).format(date);
};

function TrendChart({
  points,
  metric,
  range,
}: {
  points: StatisticPoint[];
  metric: Metric;
  range: Range;
}) {
  const values = points.flatMap((point) => {
    const value = numericValue(point[metric]);
    return value === null ? [] : [{ point, value }];
  });
  if (!values.length) return null;

  const numbers = values.map(({ value }) => value);
  const low = Math.min(...numbers);
  const high = Math.max(...numbers);
  const spread = high - low || Math.max(Math.abs(high) * 0.08, 1);
  const firstX = 28;
  const lastX = 692;
  const top = 18;
  const bottom = 154;
  const plotted = values.map(({ point, value }, index) => {
    const time = Number(point.start);
    const x =
      values.length === 1
        ? (firstX + lastX) / 2
        : firstX + (index / (values.length - 1)) * (lastX - firstX);
    const y = bottom - ((value - low) / spread) * (bottom - top);
    return { x, y, value, time };
  });
  const line = plotted.map(({ x, y }, index) => `${index ? 'L' : 'M'} ${x} ${y}`).join(' ');
  const area = `${line} L ${lastX} ${bottom} L ${firstX} ${bottom} Z`;
  const labelIndices = [0, Math.floor((plotted.length - 1) / 2), plotted.length - 1];

  return (
    <Box className="recorder-chart">
      <VectorGraphic
        viewWidth={720}
        viewHeight={190}
        role="img"
        ariaLabel={`${metricLabels[metric]} history chart`}
        linearGradient={{
          id: 'recorder-fill',
          color: 'var(--accent)',
          topOpacity: 0.2,
          bottomOpacity: 0,
        }}
        lines={[18, 63, 108, 154].map((y) => ({
          x1: 28,
          x2: 692,
          y1: y,
          y2: y,
          className: 'recorder-grid-line',
        }))}
        paths={[
          { d: area, fill: 'url(#recorder-fill)' },
          { d: line, fill: 'none', className: 'recorder-chart-line' },
        ]}
        circles={
          plotted.length < 80
            ? plotted.map(({ x, y }) => ({
                cx: x,
                cy: y,
                r: 2.5,
                className: 'recorder-chart-point',
              }))
            : []
        }
      />
      <Box className="recorder-chart-labels">
        {labelIndices.map((index) => (
          <Text key={index}>{dateLabel(plotted[index].time, range)}</Text>
        ))}
      </Box>
    </Box>
  );
}

export function StatisticsPanel({ mode, states }: { mode: 'demo' | 'live'; states: HassEntity[] }) {
  const [statistics, setStatistics] = useState<StatisticMetadata[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [range, setRange] = useState<Range>('week');
  const [metric, setMetric] = useState<Metric>('mean');
  const [points, setPoints] = useState<StatisticPoint[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingSeries, setLoadingSeries] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [retryToken, setRetryToken] = useState(0);
  const stateById = useMemo(
    () => new Map(states.map((state) => [state.entity_id, state])),
    [states],
  );
  const statisticName = (item: StatisticMetadata) =>
    String(
      item.name ||
        stateById.get(item.statistic_id)?.attributes.friendly_name ||
        titleCase(item.statistic_id.split('.').at(-1) ?? item.statistic_id),
    );

  useEffect(() => {
    if (mode !== 'live' || !window.hausNative) {
      setStatistics([]);
      setSelectedId('');
      setPoints([]);
      setError('');
      return;
    }
    let active = true;
    setLoadingList(true);
    setError('');
    void window.hausNative
      .request<StatisticMetadata[]>({ type: 'recorder/list_statistic_ids' })
      .then((result) => {
        if (!active) return;
        const rows = Array.isArray(result)
          ? result.filter(
              (item): item is StatisticMetadata =>
                Boolean(item) && typeof item.statistic_id === 'string',
            )
          : [];
        rows.sort((a, b) => statisticName(a).localeCompare(statisticName(b)));
        setStatistics(rows);
        setSelectedId((current) =>
          rows.some((item) => item.statistic_id === current)
            ? current
            : (rows.find((item) => {
                const value = stateById.get(item.statistic_id)?.state;
                return value !== undefined && numericValue(value) !== null;
              })?.statistic_id ??
              rows[0]?.statistic_id ??
              ''),
        );
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (active) setLoadingList(false);
      });
    return () => {
      active = false;
    };
  }, [mode, retryToken]);

  useEffect(() => {
    if (mode !== 'live' || !selectedId || !window.hausNative) {
      setPoints([]);
      return;
    }
    let active = true;
    const selectedRange = ranges.find((item) => item.id === range)!;
    const start = new Date(Date.now() - selectedRange.days * 86_400_000).toISOString();
    setPoints([]);
    setLoadingSeries(true);
    setError('');
    void window.hausNative
      .request<Record<string, StatisticPoint[]>>({
        type: 'recorder/statistics_during_period',
        start_time: start,
        statistic_ids: [selectedId],
        period: selectedRange.period,
        types: ['change', 'last_reset', 'max', 'mean', 'min', 'state', 'sum'],
      })
      .then((result) => {
        if (!active) return;
        setPoints(Array.isArray(result?.[selectedId]) ? result[selectedId] : []);
      })
      .catch((cause: unknown) => {
        if (active) {
          setPoints([]);
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      })
      .finally(() => {
        if (active) setLoadingSeries(false);
      });
    return () => {
      active = false;
    };
  }, [mode, range, retryToken, selectedId]);

  const selected = statistics.find((item) => item.statistic_id === selectedId);
  const selectedEntity = stateById.get(selectedId);
  const metricOptions = useMemo(() => {
    const options: Metric[] = [];
    const supportsMean = (selected?.mean_type ?? (selected?.has_mean ? 1 : 0)) !== 0;
    if (supportsMean) options.push('mean', 'min', 'max');
    if (selected?.has_sum) options.push('sum');
    if (points.some((point) => numericValue(point.state) !== null)) options.push('state');
    return options.filter((item) => points.some((point) => numericValue(point[item]) !== null));
  }, [points, selected]);
  useEffect(() => {
    if (metricOptions.length && !metricOptions.includes(metric)) setMetric(metricOptions[0]);
  }, [metric, metricOptions]);

  const filteredStatistics = statistics.filter((item) =>
    `${statisticName(item)} ${item.statistic_id}`.toLowerCase().includes(filter.toLowerCase()),
  );
  const values = points.flatMap((point) => {
    const value = numericValue(point[metric]);
    return value === null ? [] : [{ point, value }];
  });
  const latest = values.at(-1);
  const latestTime = latest ? Number(latest.point.start) : null;
  const title = selected ? statisticName(selected) : 'Statistics';
  const unit = selected?.unit_of_measurement;

  if (mode === 'demo') {
    return (
      <Box className="recorder-empty">
        <Text className="recorder-empty-icon">
          <Database size={22} />
        </Text>
        <Heading level={2}>Recorded sensor history</Heading>
        <Text semantic="p">Connect your Haus Hub to browse recorded sensor statistics.</Text>
      </Box>
    );
  }

  return (
    <Box className="recorder-page">
      <Box className="recorder-summary">
        <Box semantic="article">
          <Text>Tracked statistics</Text>
          <Text semantic="strong">{loadingList ? '—' : statistics.length}</Text>
        </Box>
        <Box semantic="article">
          <Text>Points in this view</Text>
          <Text semantic="strong">{loadingSeries ? '—' : values.length}</Text>
        </Box>
        <Box semantic="article">
          <Text>Latest recorded value</Text>
          <Text semantic="strong">{latest ? displayValue(latest.value, unit) : '—'}</Text>
        </Box>
      </Box>

      {error && (
        <Box className="recorder-error" role="status">
          <Activity size={17} />
          <Text>{error}</Text>
          <Pressable onPress={() => setRetryToken((value) => value + 1)}>
            <RefreshCw size={13} /> Retry
          </Pressable>
        </Box>
      )}

      <Box className="recorder-workspace">
        <Box semantic="aside" className="recorder-browser">
          <Box className="recorder-browser-heading">
            <Box>
              <Text semantic="strong">Recorded sensors</Text>
              <Text semantic="small">{statistics.length} recorded at home</Text>
            </Box>
          </Box>
          <Text semantic="label" className="recorder-filter">
            <Search size={15} />
            <TextInput
              value={filter}
              onChange={setFilter}
              placeholder="Find a statistic"
              ariaLabel="Find a statistic"
            />
          </Text>
          <HausScrollArea
            className="recorder-sensor-scroll"
            orientation="vertical"
            size={24}
            hideScrollBar
          >
            <Box className="recorder-sensor-list">
              {filteredStatistics.map((item) => (
                <Pressable
                  key={item.statistic_id}
                  className={`recorder-sensor${item.statistic_id === selectedId ? ' is-selected' : ''}`}
                  onPress={() => setSelectedId(item.statistic_id)}
                  title={statisticName(item)}
                >
                  <Text className="recorder-sensor-icon">
                    <Waves size={16} />
                  </Text>
                  <Text className="recorder-sensor-copy">
                    <Text semantic="strong">{statisticName(item)}</Text>
                    <Text semantic="small">{item.statistic_id}</Text>
                  </Text>
                  <Text className="recorder-sensor-unit">{item.unit_of_measurement ?? ''}</Text>
                </Pressable>
              ))}
              {!loadingList && !filteredStatistics.length && (
                <Text semantic="p" className="recorder-list-empty">
                  {statistics.length
                    ? 'No matching statistics.'
                    : 'No long-term statistics are available.'}
                </Text>
              )}
            </Box>
          </HausScrollArea>
        </Box>

        <Box semantic="section" className="recorder-detail" ariaLabel="Selected sensor statistics">
          {loadingList && !statistics.length ? (
            <Box className="recorder-detail-empty">
              <Activity size={20} />
              <Text>Loading sensor history…</Text>
            </Box>
          ) : !selected ? (
            <Box className="recorder-detail-empty">
              <Database size={20} />
              <Text>No long-term sensor history is available yet.</Text>
            </Box>
          ) : (
            <>
              <Box semantic="header" className="recorder-detail-heading">
                <Box className="recorder-detail-title">
                  <Text className="recorder-detail-icon">
                    <Waves size={19} />
                  </Text>
                  <Box>
                    <Text semantic="small">
                      {selected.source ||
                        selectedEntity?.attributes.device_class ||
                        'Recorded sensor history'}
                    </Text>
                    <Heading level={2} title={title}>
                      {title}
                    </Heading>
                    <Text>{selected.statistic_id}</Text>
                  </Box>
                </Box>
                <Box className="recorder-current-value">
                  <Text semantic="small">
                    {latestTime
                      ? `Recorded ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(latestTime)}`
                      : 'No recent value'}
                  </Text>
                  <Text semantic="strong">{latest ? displayValue(latest.value, unit) : '—'}</Text>
                </Box>
              </Box>

              <Box className="recorder-toolbar">
                <Box className="recorder-metrics" ariaLabel="Statistic type">
                  {(metricOptions.length ? metricOptions : (['mean'] as Metric[])).map((item) => (
                    <Pressable
                      key={item}
                      className={metric === item ? 'is-active' : ''}
                      ariaPressed={metric === item}
                      onPress={() => setMetric(item)}
                    >
                      {metricLabels[item]}
                    </Pressable>
                  ))}
                </Box>
                <Box className="recorder-ranges" ariaLabel="History range">
                  {ranges.map((item) => (
                    <Pressable
                      key={item.id}
                      className={range === item.id ? 'is-active' : ''}
                      ariaPressed={range === item.id}
                      onPress={() => setRange(item.id)}
                    >
                      {item.label}
                    </Pressable>
                  ))}
                </Box>
              </Box>

              {loadingSeries ? (
                <Box className="recorder-detail-empty">
                  <Activity size={20} />
                  <Text>Loading recorded values…</Text>
                </Box>
              ) : values.length ? (
                <>
                  <TrendChart points={points} metric={metric} range={range} />
                  <Box className="recorder-range-summary">
                    <Text>
                      <Text semantic="small">Low</Text>
                      <Text semantic="strong">
                        {displayValue(Math.min(...values.map((item) => item.value)), unit)}
                      </Text>
                    </Text>
                    <Text>
                      <Text semantic="small">Average</Text>
                      <Text semantic="strong">
                        {displayValue(
                          values.reduce((sum, item) => sum + item.value, 0) / values.length,
                          unit,
                        )}
                      </Text>
                    </Text>
                    <Text>
                      <Text semantic="small">High</Text>
                      <Text semantic="strong">
                        {displayValue(Math.max(...values.map((item) => item.value)), unit)}
                      </Text>
                    </Text>
                  </Box>
                </>
              ) : (
                <Box className="recorder-detail-empty">
                  <Database size={20} />
                  <Text>No recorded values for this period.</Text>
                </Box>
              )}
              <Box semantic="footer" className="recorder-source-note">
                <Database size={14} />
                Recorded locally by your home
              </Box>
            </>
          )}
        </Box>
      </Box>
    </Box>
  );
}
