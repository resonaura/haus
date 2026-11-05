/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { Button } from '@heroui/react';
import { ExternalLink, AlertTriangle } from 'lucide-react';
import type { FlowAssessment } from '@haus/ha/flow';
import { humanize, nativeApi } from '../../ha/management';

export function UnsupportedFlowFallback({
  assessment,
  domain,
  onClose,
}: {
  assessment: FlowAssessment;
  domain: string;
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
    <div className="flow-unsupported-fallback">
      <div className="flow-unsupported-icon">
        <AlertTriangle size={36} />
      </div>
      <h3>Setup Requires Home Assistant Web</h3>
      <p className="flow-description">
        {assessment.fallbackReason ??
          `The setup flow for ${humanize(domain)} requires controls not natively supported in Haus.`}
      </p>

      {assessment.unsupportedRequirements.length > 0 && (
        <ul className="flow-unsupported-list">
          {assessment.unsupportedRequirements.map((req) => (
            <li key={`${req.category}:${req.name}`}>
              <strong>{humanize(req.name)}:</strong> {req.description}
            </li>
          ))}
        </ul>
      )}

      <div className="flow-unsupported-actions">
        <Button variant="primary" onPress={handleOpenWeb}>
          Open in Home Assistant Web
          <ExternalLink size={15} />
        </Button>
        <Button variant="ghost" onPress={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
