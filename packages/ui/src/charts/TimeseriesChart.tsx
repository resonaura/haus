/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import React, { useState, useId } from 'react';
import type { TimeseriesChartProps } from './types.js';

export const TimeseriesChart: React.FC<TimeseriesChartProps> = ({
  data,
  unit = '',
  height = 180,
  strokeColor = '#3b82f6',
  fillColor: _fillColor = 'rgba(59, 130, 246, 0.15)',
  showMinMaxBand = true,
  showGrid = true,
  isLive = false,
  onHoverPoint,
  className = '',
}) => {
  const gradientId = useId();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  if (data.length === 0) {
    return React.createElement(
      'div',
      {
        className: `haus-chart-empty ${className}`.trim(),
        style: {
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'rgba(255, 255, 255, 0.4)',
          fontSize: '13px',
        },
      },
      'No data available for this range',
    );
  }

  const width = 600;
  const paddingTop = 15;
  const paddingBottom = 25;
  const paddingLeft = 45;
  const paddingRight = 15;
  const innerWidth = width - paddingLeft - paddingRight;
  const innerHeight = height - paddingTop - paddingBottom;

  // Extract min and max timestamps
  const minTs = data[0]?.timestamp ?? 0;
  const maxTs = data[data.length - 1]?.timestamp ?? minTs + 1;
  const tsRange = Math.max(maxTs - minTs, 1);

  // Extract value bounds including min/max bands
  let minVal = Number.POSITIVE_INFINITY;
  let maxVal = Number.NEGATIVE_INFINITY;
  let hasMinMax = false;

  for (const p of data) {
    const val = p.value ?? p.mean ?? p.last ?? 0;
    if (val < minVal) minVal = val;
    if (val > maxVal) maxVal = val;

    if (p.min !== undefined && p.max !== undefined) {
      hasMinMax = true;
      if (p.min < minVal) minVal = p.min;
      if (p.max > maxVal) maxVal = p.max;
    }
  }

  if (minVal === Number.POSITIVE_INFINITY) minVal = 0;
  if (maxVal === Number.NEGATIVE_INFINITY) maxVal = 1;

  // Add 5% headroom
  const valMargin = Math.max((maxVal - minVal) * 0.08, 0.5);
  const chartMinVal = minVal - valMargin;
  const chartMaxVal = maxVal + valMargin;
  const valRange = Math.max(chartMaxVal - chartMinVal, 0.001);

  const scaleX = (ts: number): number => paddingLeft + ((ts - minTs) / tsRange) * innerWidth;
  const scaleY = (val: number): number =>
    paddingTop + innerHeight - ((val - chartMinVal) / valRange) * innerHeight;

  // Build main line and area paths
  const pointsCoords = data.map((p) => ({
    x: scaleX(p.timestamp),
    y: scaleY(p.value ?? p.mean ?? p.last ?? 0),
    point: p,
  }));

  const lineD = pointsCoords
    .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`)
    .join(' ');

  const areaD = `${lineD} L ${pointsCoords[pointsCoords.length - 1].x.toFixed(1)} ${paddingTop + innerHeight} L ${pointsCoords[0].x.toFixed(1)} ${paddingTop + innerHeight} Z`;

  // Build min/max band path if available
  let bandD = '';
  if (hasMinMax && showMinMaxBand) {
    const maxPath = data
      .map((p, i) => {
        const y = scaleY(p.max ?? p.value ?? 0);
        return `${i === 0 ? 'M' : 'L'} ${scaleX(p.timestamp).toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');

    const minPath = [...data]
      .reverse()
      .map((p) => {
        const y = scaleY(p.min ?? p.value ?? 0);
        return `L ${scaleX(p.timestamp).toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');

    bandD = `${maxPath} ${minPath} Z`;
  }

  // Handle pointer interactions
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const svgX = (clientX / rect.width) * width;

    let closestIdx = 0;
    let minDiff = Number.POSITIVE_INFINITY;

    for (let i = 0; i < pointsCoords.length; i++) {
      const diff = Math.abs(pointsCoords[i].x - svgX);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = i;
      }
    }

    setHoveredIndex(closestIdx);
    onHoverPoint?.(data[closestIdx] ?? null);
  };

  const handleMouseLeave = () => {
    setHoveredIndex(null);
    onHoverPoint?.(null);
  };

  const hoveredPt = hoveredIndex !== null ? pointsCoords[hoveredIndex] : null;
  const lastPt = pointsCoords[pointsCoords.length - 1];

  return React.createElement(
    'div',
    {
      className: `haus-timeseries-chart-wrapper ${className}`.trim(),
      style: { position: 'relative', width: '100%', height },
    },
    React.createElement(
      'svg',
      {
        viewBox: `0 0 ${width} ${height}`,
        preserveAspectRatio: 'none',
        style: { width: '100%', height: '100%', display: 'block', overflow: 'visible' },
        onMouseMove: handleMouseMove,
        onMouseLeave: handleMouseLeave,
      },
      React.createElement(
        'defs',
        null,
        React.createElement(
          'linearGradient',
          { id: gradientId, x1: '0', y1: '0', x2: '0', y2: '1' },
          React.createElement('stop', { offset: '0%', stopColor: strokeColor, stopOpacity: 0.35 }),
          React.createElement('stop', { offset: '100%', stopColor: strokeColor, stopOpacity: 0.0 }),
        ),
      ),
      // Grid lines
      showGrid &&
        React.createElement(
          'g',
          { className: 'haus-chart-grid', opacity: 0.12 },
          [0, 0.5, 1].map((pct) => {
            const y = paddingTop + innerHeight * pct;
            return React.createElement('line', {
              key: pct,
              x1: paddingLeft,
              y1: y,
              x2: width - paddingRight,
              y2: y,
              stroke: '#ffffff',
              strokeWidth: 1,
              strokeDasharray: '3,3',
            });
          }),
        ),
      // Min/Max confidence band
      bandD &&
        React.createElement('path', {
          d: bandD,
          fill: strokeColor,
          opacity: 0.12,
        }),
      // Fill area under the curve
      React.createElement('path', {
        d: areaD,
        fill: `url(#${gradientId})`,
      }),
      // Stroke curve
      React.createElement('path', {
        d: lineD,
        fill: 'none',
        stroke: strokeColor,
        strokeWidth: 2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }),
      // Live indicator on last point
      isLive &&
        lastPt &&
        React.createElement(
          'g',
          { className: 'haus-live-dot' },
          React.createElement('circle', {
            cx: lastPt.x,
            cy: lastPt.y,
            r: 5,
            fill: strokeColor,
          }),
          React.createElement('circle', {
            cx: lastPt.x,
            cy: lastPt.y,
            r: 9,
            fill: 'none',
            stroke: strokeColor,
            strokeWidth: 1.5,
            opacity: 0.6,
          }),
        ),
      // Hover marker
      hoveredPt &&
        React.createElement(
          'g',
          { className: 'haus-chart-hover-indicator' },
          React.createElement('line', {
            x1: hoveredPt.x,
            y1: paddingTop,
            x2: hoveredPt.x,
            y2: paddingTop + innerHeight,
            stroke: 'rgba(255, 255, 255, 0.4)',
            strokeWidth: 1,
            strokeDasharray: '2,2',
          }),
          React.createElement('circle', {
            cx: hoveredPt.x,
            cy: hoveredPt.y,
            r: 5,
            fill: '#ffffff',
            stroke: strokeColor,
            strokeWidth: 2.5,
          }),
        ),
    ),
    // Interactive Tooltip Overlay
    hoveredPt &&
      React.createElement(
        'div',
        {
          className: 'haus-chart-tooltip',
          style: {
            position: 'absolute',
            left: `${(hoveredPt.x / width) * 100}%`,
            top: '8px',
            transform: 'translateX(-50%)',
            pointerEvents: 'none',
            backgroundColor: 'rgba(18, 18, 22, 0.92)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            borderRadius: '6px',
            padding: '4px 8px',
            fontSize: '11px',
            color: '#ffffff',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            whiteSpace: 'nowrap',
            zIndex: 10,
          },
        },
        React.createElement(
          'div',
          { style: { fontWeight: 600, color: strokeColor } },
          `${(hoveredPt.point.value ?? hoveredPt.point.mean ?? hoveredPt.point.last ?? 0).toFixed(1)} ${unit}`.trim(),
        ),
        React.createElement(
          'div',
          { style: { color: 'rgba(255,255,255,0.5)', fontSize: '10px' } },
          new Date(hoveredPt.point.timestamp * 1000).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          }),
        ),
      ),
  );
};
