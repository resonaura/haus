/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useState } from 'react';
import { Box, SelectInput, Text } from '@haus/ui';
import type { HausAccessory } from '../../model';
import { historyPoints, numericState, type HistoryPoint } from '../../model/device-history';
import { formatTemperature } from '../../model/format-temperature';
import { DeviceHistoryChart } from './DeviceHistoryChart';
export function DeviceHistory({ accessory, demo }: { accessory: HausAccessory; demo: boolean }) {
  const entities = [accessory.state, ...accessory.secondaryEntities].filter(
    (item) =>
      /^(sensor|binary_sensor|light|switch|climate|cover|fan|lock|media_player)\./.test(
        item.entity_id,
      ) && !/url|stream|token/i.test(item.entity_id),
  );
  const [id, setId] = useState(entities[0]?.entity_id ?? '');
  const [days, setDays] = useState(1);
  const [points, setPoints] = useState<HistoryPoint[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [period, setPeriod] = useState({ from: Date.now() - 86400000, to: Date.now() });
  useEffect(() => {
    let active = true;
    setError('');
    setPoints([]);
    setLoading(false);
    if (!id) return;
    if (demo || !window.hausNative) return;
    setLoading(true);
    const end = new Date();
    setPeriod({ from: +end - days * 86400000, to: +end });
    void window.hausNative
      .request<Record<string, Array<Record<string, any>>>>({
        type: 'history/history_during_period',
        entity_ids: [id],
        start_time: new Date(+end - days * 86400000).toISOString(),
        end_time: end.toISOString(),
        minimal_response: true,
        no_attributes: true,
        include_start_time_state: true,
        significant_changes_only: false,
      })
      .then((result) => {
        if (active) setPoints(historyPoints(result[id] ?? [], +end - days * 86400000, +end));
      })
      .catch((reason) => {
        if (active) setError(reason.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id, days, demo]);
  const selectedEntity = entities.find((item) => item.entity_id === id);
  const unit = selectedEntity?.attributes.unit_of_measurement ?? '';
  const isTemperature = selectedEntity?.attributes.device_class === 'temperature';
  const suggestedPrecision = selectedEntity?.attributes.suggested_display_precision;
  const precision =
    isTemperature &&
    typeof suggestedPrecision === 'number' &&
    Number.isInteger(suggestedPrecision) &&
    suggestedPrecision >= 0 &&
    suggestedPrecision <= 6
      ? suggestedPrecision
      : isTemperature
        ? 1
        : 3;
  return (
    <Box semantic="section" className="device-history">
      <Box className="device-history-filters">
        <Text semantic="label">
          Measurement
          <SelectInput
            ariaLabel="History measurement"
            value={id}
            options={entities.map((item) => ({
              value: item.entity_id,
              label: String(item.attributes.friendly_name ?? item.entity_id),
            }))}
            onChange={setId}
          />
        </Text>
        <Text semantic="label">
          Period
          <SelectInput
            ariaLabel="History period"
            value={String(days)}
            options={[
              { value: '1', label: '24 hours' },
              { value: '7', label: '7 days' },
            ]}
            onChange={(nextVal) => setDays(Number(nextVal))}
          />
        </Text>
      </Box>
      {loading && (
        <Text semantic="p" role="status">
          Loading history…
        </Text>
      )}
      {error && (
        <Text semantic="p" role="alert">
          {error}
        </Text>
      )}
      {!loading && !error && !points.length && (
        <Text semantic="p">
          {demo
            ? 'Connect your home to see recorded device history.'
            : 'No recorded states in this period.'}
        </Text>
      )}
      <DeviceHistoryChart
        key={`${id}:${days}`}
        points={points}
        from={period.from}
        to={period.to}
        unit={String(unit)}
        precision={precision}
      />
      <Box semantic="ordered-list" className="device-history-log">
        {points
          .slice(-100)
          .reverse()
          .map((point, index) => (
            <Box semantic="listitem" key={`${point.at}:${index}`}>
              <Text semantic="time" dateTime={new Date(point.at).toISOString()}>
                {new Date(point.at).toLocaleString()}
              </Text>
              <Text semantic="strong">
                {isTemperature
                  ? (formatTemperature(point.state, precision) ?? point.state.replaceAll('_', ' '))
                  : point.state.replaceAll('_', ' ')}{' '}
                {numericState(point.state) === undefined ? '' : unit}
              </Text>
            </Box>
          ))}
      </Box>
    </Box>
  );
}
