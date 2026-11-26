/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useEffect, useState, type ReactNode } from 'react';
import {
  formatAppCapabilityLabel,
  type AppActionId,
  type InstalledAppRecord,
} from '@haus/core/transport';
import { colorToken, corners, insets, pct, px, rgba } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import {
  HausButton,
  HausDialog,
  Pressable,
  Row,
  ScrollView,
  Stack,
  Text,
  useHausUi,
} from '../../primitives/index.js';
import { UiIcon } from '../icon.js';
import { BrandIcon, ManagementGlassCard, ManagementStatusPill } from '../brand/index.js';

export function AppDetailsModal({
  app,
  logs,
  logsLoading,
  canManage,
  busy,
  error,
  configSlot,
  onAction,
  onRefreshLogs,
  onOpenConfig,
  onRemove,
  onClose,
}: {
  readonly app: InstalledAppRecord;
  readonly logs: string;
  readonly logsLoading: boolean;
  readonly canManage: boolean;
  readonly busy: boolean;
  readonly error?: string;
  readonly configSlot?: ReactNode;
  readonly onAction: (action: AppActionId) => void;
  readonly onRefreshLogs: () => void;
  readonly onOpenConfig?: () => void;
  readonly onRemove?: () => void;
  readonly onClose: () => void;
}) {
  const { theme } = useHausUi();
  const primaryFg = theme.mode === 'dark' ? '#101010' : '#ffffff';
  const [tab, setTab] = useState<'overview' | 'config' | 'logs'>('overview');
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    setConfirmRemove(false);
    setTab('overview');
  }, [app.id]);

  const showConfigTab = Boolean(canManage && app.managed && configSlot);

  return (
    <HausDialog
      size="md"
      title={app.name}
      subtitle={[app.version ? `Version ${app.version}` : undefined, app.state]
        .filter(Boolean)
        .join(' · ')}
      scrollable
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <Row justify="end" style={{ layout: { width: pct(100) } }}>
          <HausButton id="app-detail-done" variant="secondary" disabled={busy} onPress={onClose}>
            Done
          </HausButton>
        </Row>
      }
    >
      <Stack gapPx={14} style={{ layout: { width: pct(100) } }}>
        <ManagementGlassCard
          radius={18}
          padding={insets(12, 14)}
          style={{ layout: { width: pct(100) } }}
        >
          <Row align="center" justify="between" gapPx={12} style={{ layout: { width: pct(100) } }}>
            <Row align="center" gapPx={12} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
              <BrandIcon
                kind="app"
                id={app.externalId || app.id}
                size={42}
                hint={{ name: app.name, addonSlug: app.externalId }}
              />
              <Stack gapPx={2} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
                <Text size={14.5} weight={600}>
                  {app.name}
                </Text>
                <Text size={12} tone="muted">
                  {app.version ? `Version ${app.version}` : app.externalId}
                </Text>
              </Stack>
            </Row>
            <ManagementStatusPill
              label={app.available ? app.state : 'Unavailable'}
              tone={!app.available ? 'warning' : app.state === 'running' ? 'success' : 'neutral'}
              showDot
            />
          </Row>
        </ManagementGlassCard>
        <Row align="center" gapPx={8} wrap>
          <Pressable
            id="app-detail-tab-overview"
            ariaPressed={tab === 'overview'}
            onActivate={() => setTab('overview')}
            style={{
              layout: { direction: 'row', alignItems: 'center', padding: insets(6, 12) },
              material: new SolidMaterial(
                tab === 'overview' ? colorToken('surfaceActive') : colorToken('surfaceSecondary'),
              ),
              border: {
                width: 1,
                color: tab === 'overview' ? colorToken('accent') : colorToken('border'),
              },
              corners: corners(999),
            }}
          >
            <Text size={12} weight={tab === 'overview' ? 600 : 500}>
              Overview
            </Text>
          </Pressable>
          {showConfigTab && (
            <Pressable
              id="app-detail-tab-config"
              ariaPressed={tab === 'config'}
              onActivate={() => {
                setTab('config');
                onOpenConfig?.();
              }}
              style={{
                layout: {
                  direction: 'row',
                  alignItems: 'center',
                  gap: px(6),
                  padding: insets(6, 12),
                },
                material: new SolidMaterial(
                  tab === 'config' ? colorToken('surfaceActive') : colorToken('surfaceSecondary'),
                ),
                border: {
                  width: 1,
                  color: tab === 'config' ? colorToken('accent') : colorToken('border'),
                },
                corners: corners(999),
              }}
            >
              <UiIcon name="sliders-horizontal" size={13} />
              <Text size={12} weight={tab === 'config' ? 600 : 500}>
                Configuration
              </Text>
            </Pressable>
          )}
          {app.logs && (
            <Pressable
              id="app-detail-tab-logs"
              ariaPressed={tab === 'logs'}
              onActivate={() => {
                setTab('logs');
                if (!logs) onRefreshLogs();
              }}
              style={{
                layout: {
                  direction: 'row',
                  alignItems: 'center',
                  gap: px(6),
                  padding: insets(6, 12),
                },
                material: new SolidMaterial(
                  tab === 'logs' ? colorToken('surfaceActive') : colorToken('surfaceSecondary'),
                ),
                border: {
                  width: 1,
                  color: tab === 'logs' ? colorToken('accent') : colorToken('border'),
                },
                corners: corners(999),
              }}
            >
              <UiIcon name="file-text" size={13} />
              <Text size={12} weight={tab === 'logs' ? 600 : 500}>
                Logs
              </Text>
            </Pressable>
          )}
        </Row>

        {error && (
          <Text size={12} tone="critical" role="alert">
            {error}
          </Text>
        )}

        {tab === 'overview' ? (
          <Stack gapPx={12}>
            <Text size={12.5} tone="muted">
              {formatAppCapabilityLabel(app)}
            </Text>
            {canManage && app.managed && app.actions.length > 0 && (
              <Row align="center" gapPx={8} wrap>
                {app.actions.map((action) => (
                  <HausButton
                    key={action}
                    id={`app-detail-action-${action}`}
                    variant={action === 'start' ? 'primary' : 'outline'}
                    size="sm"
                    disabled={busy}
                    onPress={() => onAction(action)}
                  >
                    <UiIcon
                      name={
                        action === 'start' ? 'play' : action === 'stop' ? 'square' : 'rotate-cw'
                      }
                      size={13}
                      color={action === 'start' ? primaryFg : undefined}
                    />
                    <Text
                      size={12.5}
                      style={
                        action === 'start'
                          ? { typography: { color: colorToken('accentForeground'), weight: 600 } }
                          : undefined
                      }
                    >
                      {action === 'start' ? 'Start' : action === 'stop' ? 'Stop' : 'Restart'}
                    </Text>
                  </HausButton>
                ))}
              </Row>
            )}
            {canManage && app.managed && onRemove && (
              <Stack
                gapPx={8}
                style={{
                  layout: { width: pct(100), padding: insets(12) },
                  material: new SolidMaterial(
                    confirmRemove ? rgba(239, 68, 68, 0.1) : colorToken('surfaceSecondary'),
                  ),
                  border: {
                    width: 1,
                    color: confirmRemove ? rgba(239, 68, 68, 0.35) : colorToken('border'),
                  },
                  corners: corners(12),
                }}
              >
                {!confirmRemove ? (
                  <Row align="center" justify="between" gapPx={10} wrap>
                    <Stack gapPx={2}>
                      <Text size={12.5} weight={600}>
                        Remove App
                      </Text>
                      <Text size={11.5} tone="muted">
                        Uninstall this App and stop its managed runtime.
                      </Text>
                    </Stack>
                    <HausButton
                      id="app-detail-remove"
                      variant="danger-soft"
                      size="sm"
                      disabled={busy}
                      onPress={() => setConfirmRemove(true)}
                    >
                      <UiIcon name="trash-2" size={13} />
                      <Text size={12.5}>Remove</Text>
                    </HausButton>
                  </Row>
                ) : (
                  <Row align="center" justify="between" gapPx={10} wrap>
                    <Text size={12} weight={600}>
                      {`Remove ${app.name}? This stops the runtime and removes the container.`}
                    </Text>
                    <Row align="center" gapPx={8}>
                      <HausButton
                        id="app-detail-remove-cancel"
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onPress={() => setConfirmRemove(false)}
                      >
                        Cancel
                      </HausButton>
                      <HausButton
                        id="app-detail-remove-confirm"
                        variant="danger"
                        size="sm"
                        disabled={busy}
                        onPress={onRemove}
                      >
                        Remove App
                      </HausButton>
                    </Row>
                  </Row>
                )}
              </Stack>
            )}
          </Stack>
        ) : tab === 'config' && showConfigTab ? (
          configSlot
        ) : (
          <Stack gapPx={10}>
            <Row align="center" justify="between">
              <Text size={11.5} tone="muted">
                Recent service output
              </Text>
              <HausButton
                id="app-detail-refresh-logs"
                variant="ghost"
                size="sm"
                disabled={logsLoading}
                onPress={onRefreshLogs}
              >
                <UiIcon name="refresh-cw" size={13} />
                <Text size={12}>{logsLoading ? 'Loading…' : 'Refresh logs'}</Text>
              </HausButton>
            </Row>
            <ScrollView
              orientation="vertical"
              style={{
                layout: { width: pct(100), maxHeight: px(220), padding: insets(12) },
                material: new SolidMaterial(colorToken('surfaceSecondary')),
                border: { width: 1, color: colorToken('border') },
                corners: corners(10),
              }}
            >
              <Text size={11.5} tone="muted">
                {logs || 'No logs available yet.'}
              </Text>
            </ScrollView>
          </Stack>
        )}
      </Stack>
    </HausDialog>
  );
}
