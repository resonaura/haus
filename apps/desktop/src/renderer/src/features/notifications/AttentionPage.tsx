/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { Box } from '@haus/ui';
import { AttentionFeed } from '@haus/ui/components';
import { ServerMarkdown } from '../../components/ui/ServerMarkdown';
import { message } from '../../hooks/useHaus';
import type { useHomeNotifications } from '../../hooks/useHomeNotifications';
import type { HausModel } from '../../model';

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
    <AttentionFeed
      notices={homeNotices.notifications}
      attention={appAttention}
      error={homeNotices.error || undefined}
      renderBody={(text) => (
        <Box className="home-notice-body">
          <ServerMarkdown text={text} />
        </Box>
      )}
      onDismissNotice={(notificationId) =>
        void homeNotices.dismiss(notificationId).catch((error) => notify(message(error)))
      }
      onReviewNotice={(notice) => {
        if (onReviewNotice && (notice.kind === 'update' || notice.kind === 'repair')) {
          onReviewNotice(notice.kind);
        } else {
          openServer(notice.kind === 'update' ? '/config/updates' : '/config/repairs');
        }
      }}
      onOpenEntity={onOpenEntity}
    />
  );
}
