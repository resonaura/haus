/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import React from 'react';
import {
  getCategoryMetadata,
  type DeviceCategory,
  type DeviceBadgeStatus,
} from '../categories/index.js';

export interface StatusBadgeProps {
  readonly status: DeviceBadgeStatus;
  readonly label?: string;
  readonly className?: string;
}

const BADGE_COLORS: Record<DeviceBadgeStatus, { bg: string; text: string; border: string }> = {
  online: { bg: 'rgba(16, 185, 129, 0.15)', text: '#10b981', border: 'rgba(16, 185, 129, 0.3)' },
  offline: { bg: 'rgba(107, 114, 128, 0.15)', text: '#9ca3af', border: 'rgba(107, 114, 128, 0.3)' },
  active: { bg: 'rgba(59, 130, 246, 0.15)', text: '#3b82f6', border: 'rgba(59, 130, 246, 0.3)' },
  alert: { bg: 'rgba(239, 68, 68, 0.15)', text: '#ef4444', border: 'rgba(239, 68, 68, 0.3)' },
  warning: { bg: 'rgba(245, 158, 11, 0.15)', text: '#f59e0b', border: 'rgba(245, 158, 11, 0.3)' },
  low_battery: {
    bg: 'rgba(245, 158, 11, 0.15)',
    text: '#f59e0b',
    border: 'rgba(245, 158, 11, 0.3)',
  },
  updating: { bg: 'rgba(139, 92, 246, 0.15)', text: '#8b5cf6', border: 'rgba(139, 92, 246, 0.3)' },
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, label, className = '' }) => {
  const theme = BADGE_COLORS[status] ?? BADGE_COLORS.offline;
  const displayLabel = label ?? status.replace('_', ' ');

  return React.createElement(
    'span',
    {
      className: `haus-status-badge ${className}`.trim(),
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 8px',
        borderRadius: '9999px',
        fontSize: '11px',
        fontWeight: 600,
        textTransform: 'capitalize',
        backgroundColor: theme.bg,
        color: theme.text,
        border: `1px solid ${theme.border}`,
        lineHeight: 1.2,
      },
    },
    displayLabel,
  );
};

export interface CategoryIconProps {
  readonly category: DeviceCategory;
  readonly size?: number;
  readonly color?: string;
  readonly className?: string;
}

export const CategoryIcon: React.FC<CategoryIconProps> = ({
  category,
  size = 20,
  color,
  className = '',
}) => {
  const meta = getCategoryMetadata(category);
  const strokeColor = color ?? meta.accentColor;

  return React.createElement(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: strokeColor,
      strokeWidth: 2,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      className: `haus-category-icon ${className}`.trim(),
      'aria-label': meta.label,
      role: 'img',
    },
    React.createElement('circle', { cx: 12, cy: 12, r: 9, strokeOpacity: 0.2 }),
    React.createElement('path', { d: 'M12 7v5l3 3' }),
  );
};

export interface DeviceCardProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly category: DeviceCategory;
  readonly status: DeviceBadgeStatus;
  readonly statusLabel?: string;
  readonly onClick?: () => void;
  readonly actionSlot?: React.ReactNode;
  readonly className?: string;
}

export const DeviceCard: React.FC<DeviceCardProps> = ({
  title,
  subtitle,
  category,
  status,
  statusLabel,
  onClick,
  actionSlot,
  className = '',
}) => {
  const meta = getCategoryMetadata(category);

  return React.createElement(
    'div',
    {
      onClick,
      className: `haus-device-card ${className}`.trim(),
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        borderRadius: '12px',
        backgroundColor: '#15191e',
        border: '1px solid #2a313a',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'all 0.15s ease-in-out',
      },
    },
    React.createElement(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: '12px' } },
      React.createElement(CategoryIcon, { category, size: 24 }),
      React.createElement(
        'div',
        null,
        React.createElement(
          'div',
          { style: { fontSize: '14px', fontWeight: 600, color: '#f3f4f6' } },
          title,
        ),
        subtitle &&
          React.createElement('div', { style: { fontSize: '12px', color: '#9ca3af' } }, subtitle),
      ),
    ),
    React.createElement(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
      React.createElement(StatusBadge, { status, label: statusLabel ?? meta.singularLabel }),
      actionSlot,
    ),
  );
};

export interface ControlTileProps {
  readonly title: string;
  readonly stateText: string;
  readonly category: DeviceCategory;
  readonly active: boolean;
  readonly onToggle?: () => void;
  readonly className?: string;
}

export const ControlTile: React.FC<ControlTileProps> = ({
  title,
  stateText,
  category,
  active,
  onToggle,
  className = '',
}) => {
  return React.createElement(
    'button',
    {
      type: 'button',
      onClick: onToggle,
      className: `haus-control-tile ${className}`.trim(),
      style: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        width: '100%',
        minHeight: '84px',
        padding: '14px',
        borderRadius: '14px',
        border: active ? '1px solid rgba(59, 130, 246, 0.4)' : '1px solid #2a313a',
        backgroundColor: active ? 'rgba(59, 130, 246, 0.12)' : '#15191e',
        color: '#f3f4f6',
        cursor: onToggle ? 'pointer' : 'default',
        transition: 'all 0.15s ease',
      },
    },
    React.createElement(CategoryIcon, {
      category,
      size: 22,
      color: active ? '#3b82f6' : undefined,
    }),
    React.createElement(
      'div',
      { style: { marginTop: '8px', textAlign: 'left' } },
      React.createElement(
        'div',
        { style: { fontSize: '13px', fontWeight: 600, color: active ? '#ffffff' : '#f3f4f6' } },
        title,
      ),
      React.createElement(
        'div',
        { style: { fontSize: '11px', color: active ? '#93c5fd' : '#9ca3af' } },
        stateText,
      ),
    ),
  );
};
