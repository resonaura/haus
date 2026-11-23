/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useState } from 'react';
import { Box, HausButton, Heading } from '@haus/ui';
import type { RepairIssue } from '../../model/notifications';
import { homeNotifications } from '../../model/notifications';
import { nativeApi, translationStrings } from '../../ha/management';
import { ServerMarkdown } from '../../components/ui/ServerMarkdown';
import type { FlowTarget } from './IntegrationFlow';
export function IntegrationRepairList({
  issues,
  admin,
  onFlow,
}: {
  issues: RepairIssue[];
  admin: boolean;
  onFlow: (flow: FlowTarget) => void;
}) {
  const [resources, setResources] = useState<Record<string, string>>({});
  const domains = [...new Set(issues.map((issue) => issue.domain))].sort().join(',');
  useEffect(() => {
    let active = true;
    if (domains)
      void nativeApi()
        .request<{ resources: Record<string, unknown> }>({
          type: 'frontend/get_translations',
          language: 'en',
          category: 'issues',
          integration: domains.split(','),
        })
        .then((result) => {
          if (active) setResources(translationStrings(result.resources));
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [domains]);
  return (
    <Box className="integration-repairs">
      {issues.map((issue) => {
        const notice = homeNotifications([], [], [issue], resources)[0];
        return (
          <Box
            semantic="article"
            className="integration-repair"
            key={`${issue.domain}:${issue.issue_id}`}
          >
            <Box>
              <Heading level={3}>{notice?.title ?? 'Connection needs attention'}</Heading>
              <ServerMarkdown text={notice?.message ?? 'Review the connection to continue.'} />
            </Box>
            {issue.is_fixable && (
              <HausButton
                variant="secondary"
                isDisabled={!admin}
                onPress={() => onFlow({ domain: issue.domain, repair: issue })}
              >
                Resolve
              </HausButton>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
