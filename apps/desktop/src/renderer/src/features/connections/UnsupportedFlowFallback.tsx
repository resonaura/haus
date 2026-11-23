/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { Box, HausButton, Heading, Text } from '@haus/ui';
import { ExternalLink, AlertTriangle } from 'lucide-react';
import type { FlowAssessment } from '@haus/ha/flow';
import { humanize, nativeApi } from '../../ha/management';

export function UnsupportedFlowFallback({
  assessment,
  domain,
  domainName,
  onClose,
}: {
  assessment: FlowAssessment;
  domain: string;
  domainName?: string;
  onClose: () => void;
}) {
  const handleOpenWeb = async () => {
    let target = assessment.fallbackUrl ?? '/config/integrations/dashboard';
    if (target.startsWith('/')) {
      const session = await nativeApi().getSession();
      if (session?.url) {
        target = `${session.url.replace(/\/+$/, '')}${target}`;
      }
    }
    void nativeApi()
      .openExternal(target)
      .catch(() => {
        window.open(target, '_blank');
      });
  };

  return (
    <Box className="flow-unsupported-fallback">
      <Box className="flow-unsupported-icon">
        <AlertTriangle size={36} />
      </Box>
      <Heading level={3}>Setup Requires Home Assistant Web</Heading>
      <Text semantic="p" className="flow-description">
        {assessment.fallbackReason ??
          `The setup flow for ${domainName || domain} requires controls not natively supported in Haus.`}
      </Text>

      {assessment.unsupportedRequirements.length > 0 && (
        <Box semantic="list" className="flow-unsupported-list">
          {assessment.unsupportedRequirements.map((req) => (
            <Box semantic="listitem" key={`${req.category}:${req.name}`}>
              <Text semantic="strong">{humanize(req.name)}:</Text> {req.description}
            </Box>
          ))}
        </Box>
      )}

      <Box className="flow-unsupported-actions">
        <HausButton variant="primary" onPress={handleOpenWeb}>
          Open in Home Assistant Web
          <ExternalLink size={15} />
        </HausButton>
        <HausButton variant="ghost" onPress={onClose}>
          Cancel
        </HausButton>
      </Box>
    </Box>
  );
}
