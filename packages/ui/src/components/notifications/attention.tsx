/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { ReactNode } from 'react';
import { colorToken, corners, insets, pct, px, rgba } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import {
  Box,
  HausButton,
  Heading,
  Pressable,
  Row,
  Stack,
  Text,
} from '../../primitives/index.js';
import { UiIcon } from '../icon.js';

export interface PortableHomeNotice {
  readonly id: string;
  readonly kind: 'notification' | 'update' | 'repair';
  readonly title: string;
  readonly message: string;
  readonly createdAt?: string;
  readonly entityId?: string;
  readonly notificationId?: string;
  readonly severity: 'info' | 'warning' | 'critical';
}

export interface PortableAttentionItem {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly entityId: string;
  readonly severity: 'warning' | 'critical';
}

function readableNoticeBody(raw: string): string {
  return raw
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

export function AttentionFeed({
  notices,
  attention,
  error,
  renderBody,
  onDismissNotice,
  onReviewNotice,
  onOpenEntity,
}: {
  readonly notices: readonly PortableHomeNotice[];
  readonly attention: readonly PortableAttentionItem[];
  readonly error?: string;
  readonly renderBody?: (message: string) => ReactNode;
  readonly onDismissNotice?: (notificationId: string) => void;
  readonly onReviewNotice?: (notice: PortableHomeNotice) => void;
  readonly onOpenEntity?: (entityId: string) => void;
}) {
  if (!error && notices.length === 0 && attention.length === 0) {
    return (
      <Stack
        align="center"
        justify="center"
        gapPx={10}
        style={{
          layout: { width: pct(100), padding: insets(36, 20) },
          material: new SolidMaterial(colorToken('surface')),
          border: { width: 1, color: colorToken('border') },
          corners: corners(20),
        }}
      >
        <Box
          style={{
            layout: { padding: insets(12) },
            material: new SolidMaterial(colorToken('soft')),
            corners: corners(14),
          }}
        >
          <UiIcon name="shield-check" size={24} />
        </Box>
        <Heading level={3}>Everything feels right</Heading>
        <Text tone="muted" size={13}>
          Your home has no alerts that need your attention.
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gapPx={10}>
      {Boolean(error) && (
        <Box
          style={{
            layout: { padding: insets(12, 14) },
            material: new SolidMaterial(rgba(255, 69, 58, 0.14)),
            border: { width: 1, color: rgba(255, 69, 58, 0.35) },
            corners: corners(14),
          }}
        >
          <Text tone="critical" size={13}>
            {error}
          </Text>
        </Box>
      )}
      {notices.map((notice) => {
        const critical = notice.severity === 'critical';
        const categoryLabel =
          notice.kind === 'update'
            ? 'Software update'
            : notice.kind === 'repair'
              ? 'Repairs'
              : 'Your home';
        return (
          <Row
            key={notice.id}
            align="center"
            justify="between"
            gapPx={14}
            style={{
              layout: { padding: insets(14, 16) },
              material: new SolidMaterial(colorToken('surface')),
              border: {
                width: 1,
                color: critical ? rgba(255, 69, 58, 0.42) : colorToken('border'),
              },
              corners: corners(16),
            }}
          >
            <Row align="start" gapPx={12} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
              <Box
                style={{
                  layout: { padding: insets(8), flexShrink: 0 },
                  material: new SolidMaterial(
                    critical ? rgba(255, 69, 58, 0.16) : colorToken('surfaceHover'),
                  ),
                  corners: corners(10),
                }}
              >
                <UiIcon name="bell" size={18} color={critical ? '#ff453a' : undefined} />
              </Box>
              <Stack gapPx={4} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
                <Text tone="muted" size={11} weight={600}>
                  {categoryLabel}
                </Text>
                <Text weight={600} size={14}>
                  {notice.title}
                </Text>
                {renderBody ? (
                  renderBody(notice.message)
                ) : (
                  <Text tone="muted" size={12}>
                    {readableNoticeBody(notice.message)}
                  </Text>
                )}
              </Stack>
            </Row>
            {notice.notificationId && onDismissNotice ? (
              <HausButton
                id={`dismiss-notice-${notice.notificationId}`}
                variant="ghost"
                onPress={() => onDismissNotice(notice.notificationId!)}
              >
                Dismiss
              </HausButton>
            ) : (
              onReviewNotice && (
                <HausButton
                  id={`review-notice-${notice.id}`}
                  variant="secondary"
                  onPress={() => onReviewNotice(notice)}
                >
                  Review
                </HausButton>
              )
            )}
          </Row>
        );
      })}
      {attention.map((item) => {
        const critical = item.severity === 'critical';
        return (
          <Pressable
            key={item.id}
            id={`attention-${item.id}`}
            onActivate={() => onOpenEntity?.(item.entityId)}
            style={{
              layout: {
                display: 'flex',
                direction: 'row',
                alignItems: 'center',
                justifyContent: 'between',
                gap: px(12),
                padding: insets(14, 16),
                width: pct(100),
              },
              material: new SolidMaterial(colorToken('surface')),
              border: {
                width: 1,
                color: critical ? rgba(255, 69, 58, 0.42) : colorToken('border'),
              },
              corners: corners(16),
              states: {
                hover: { material: new SolidMaterial(colorToken('surfaceHover')) },
              },
            }}
          >
            <Row align="center" gapPx={12} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
              <Box
                style={{
                  layout: { padding: insets(8), flexShrink: 0 },
                  material: new SolidMaterial(
                    critical ? rgba(255, 69, 58, 0.16) : colorToken('surfaceHover'),
                  ),
                  corners: corners(10),
                }}
              >
                <UiIcon name="bell" size={18} color={critical ? '#ff453a' : undefined} />
              </Box>
              <Stack gapPx={3} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
                <Text weight={600} size={14}>
                  {item.title}
                </Text>
                <Text tone="muted" size={12}>
                  {item.description}
                </Text>
              </Stack>
            </Row>
            <UiIcon name="chevron-right" size={16} />
          </Pressable>
        );
      })}
    </Stack>
  );
}
