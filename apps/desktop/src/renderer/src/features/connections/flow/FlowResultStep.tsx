/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Box, Heading, Text } from '@haus/ui';
import { Check } from 'lucide-react';
import type { FlowStep } from '../../../ha/management';
import { ServerMarkdown } from '../../../components/ui/ServerMarkdown';
import { ApplicationCredentialsPrompt } from './OAuthExternalStep';
import { TuyaCameraFollowup } from './TuyaCameraFollowup';

/** Renders terminal `create_entry` or `abort` step outcome (including Tuya camera & OAuth credential prompts). */
export function FlowResultStep({
  step,
  domain,
  domainName,
  tuyaFollowup,
  isHubSession,
  text,
  humanizeSlug,
  onNoTuyaCameras,
  onDone,
  onClose,
  onRetry,
  onError,
}: {
  step: FlowStep;
  domain: string;
  domainName?: string;
  tuyaFollowup: 'none' | 'active' | 'done';
  isHubSession: boolean | null;
  text: (suffix: string, fallback: string) => string;
  humanizeSlug: (value: string) => string;
  onNoTuyaCameras: () => void;
  onDone: (step: FlowStep) => void;
  onClose: () => void;
  onRetry: () => void;
  onError: (msg: string) => void;
}) {
  if (step.type === 'create_entry' && tuyaFollowup === 'active') {
    return (
      <TuyaCameraFollowup
        entryId={step.result?.entry_id}
        entryTitle={step.result?.title}
        onNoCameras={onNoTuyaCameras}
        onComplete={() => onDone(step)}
        onCancel={onClose}
      />
    );
  }

  return (
    <Box className="flow-result">
      {step.type === 'create_entry' ? (
        <Check size={34} />
      ) : (
        <Text className="management-result-symbol">i</Text>
      )}
      <Heading level={3}>
        {step.type === 'create_entry'
          ? 'Connection updated'
          : text(`abort.${step.reason}`, humanizeSlug(step.reason ?? 'Setup ended'))}
      </Heading>
      {step.type === 'abort' && step.description && (
        <Box className="flow-description">
          <ServerMarkdown text={step.description} />
        </Box>
      )}
      {step.type === 'abort' &&
        isHubSession &&
        (step.reason === 'missing_credentials' || step.reason === 'oauth_unauthorized') && (
          <ApplicationCredentialsPrompt
            domain={domain}
            domainName={domainName}
            onRetry={onRetry}
            onError={onError}
          />
        )}
    </Box>
  );
}
