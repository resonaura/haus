/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Box, HausButton, Heading, Pressable, Text } from '@haus/ui';
import { Bell, ChevronRight, ShieldCheck } from 'lucide-react';
import type { HausModel } from '../../model';
import type { useHomeNotifications } from '../../hooks/useHomeNotifications';
import { message } from '../../hooks/useHaus';
import { ServerMarkdown } from '../../components/ui/ServerMarkdown';
import { EmptyState as Empty } from '@haus/ui/components';
type Props = {
  homeNotices: ReturnType<typeof useHomeNotifications>;
  appAttention: HausModel['attention'];
  onOpenEntity: (id: string) => void;
  notify: (text: string) => void;
  openServer: (path: string) => void;
  onReviewNotice?: (kind: 'update' | 'repair') => void;
};
export function AttentionPage({
  homeNotices,
  appAttention,
  onOpenEntity,
  notify,
  openServer,
  onReviewNotice,
}: Props) {
  return (
    <Box className="attention-list">
      {homeNotices.error && (
        <Text semantic="p" role="status" className="form-error">
          {homeNotices.error}
        </Text>
      )}
      {homeNotices.notifications.map((notice) => (
        <Box semantic="article" className="home-notice" key={notice.id}>
          <Text className={`attention-icon ${notice.severity === 'critical' ? 'critical' : ''}`}>
            <Bell size={21} />
          </Text>
          <Box>
            <Text semantic="small">
              {notice.kind === 'update'
                ? 'Software update'
                : notice.kind === 'repair'
                  ? 'Repairs'
                  : 'Your home'}
            </Text>
            <Heading level={3}>{notice.title}</Heading>
            <Box className="home-notice-body">
              <ServerMarkdown text={notice.message} />
            </Box>
          </Box>
          {notice.notificationId ? (
            <HausButton
              variant="ghost"
              onPress={() =>
                void homeNotices
                  .dismiss(notice.notificationId!)
                  .catch((error) => notify(message(error)))
              }
            >
              Dismiss
            </HausButton>
          ) : (
            <HausButton
              variant="secondary"
              onPress={() => {
                if (onReviewNotice && (notice.kind === 'update' || notice.kind === 'repair')) {
                  onReviewNotice(notice.kind);
                } else {
                  openServer(notice.kind === 'update' ? '/config/updates' : '/config/repairs');
                }
              }}
            >
              Review <ChevronRight size={15} />
            </HausButton>
          )}
        </Box>
      ))}
      {appAttention.length ? (
        appAttention.map((a) => (
          <Pressable key={a.id} onPress={() => onOpenEntity(a.entityId)}>
            <Text className={`attention-icon ${a.severity === 'critical' ? 'critical' : ''}`}>
              <Bell size={21} />
            </Text>
            <Text>
              <Text semantic="strong">{a.title}</Text>
              <Text semantic="small">{a.description}</Text>
            </Text>
            <ChevronRight size={18} />
          </Pressable>
        ))
      ) : !homeNotices.notifications.length && !homeNotices.error ? (
        <Empty
          icon={<ShieldCheck />}
          title="Everything feels right"
          description="Your home has no alerts that need your attention."
        />
      ) : null}
    </Box>
  );
}
