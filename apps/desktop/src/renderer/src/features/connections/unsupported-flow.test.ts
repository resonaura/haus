/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { describe, expect, it } from 'vitest';
import {
  evaluateFlowProgress,
  evaluateFlowStep,
  getIntegrationFlowProfile,
  type FlowProgress,
  type FlowStep,
} from '@haus/ha/flow';

describe('UnsupportedFlow fallback and capability adaptation in Desktop UI', () => {
  const haServerUrl = 'http://192.168.1.150:8123';

  it('provides honest fallback metadata when a flow step encounters custom selectors', () => {
    const customStep: FlowStep = {
      type: 'form',
      flow_id: 'flow-custom-selector-456',
      handler: 'custom_service',
      step_id: 'step_one',
      data_schema: [
        { name: 'name', type: 'string' },
        { name: 'custom_icon', selector: { icon: {} } },
        { name: 'conversation', selector: { conversation_agent: {} } },
      ],
    };

    const assessment = evaluateFlowStep(customStep, { serverUrl: haServerUrl });

    expect(assessment.supported).toBe(false);
    expect(assessment.status).toBe('unsupported');
    expect(assessment.unsupportedRequirements).toHaveLength(2);
    expect(assessment.unsupportedRequirements.map((r) => r.name)).toEqual([
      'icon',
      'conversation_agent',
    ]);
    expect(assessment.fallbackUrl).toBe(
      `${haServerUrl}/config/config_entries/flow/flow-custom-selector-456`,
    );
    expect(assessment.fallbackReason).toContain('icon, conversation_agent');
  });

  it('allows form steps with standard and relational selectors', () => {
    const supportedStep: FlowStep = {
      type: 'form',
      flow_id: 'flow-ok-123',
      handler: 'generic',
      step_id: 'user',
      data_schema: [
        { name: 'rtsp_url', type: 'string' },
        { name: 'framerate', type: 'integer' },
        { name: 'authentication', selector: { select: { options: ['basic', 'digest'] } } },
        { name: 'linked_device', selector: { device: {} } },
      ],
    };

    const assessment = evaluateFlowStep(supportedStep, { serverUrl: haServerUrl });

    expect(assessment.supported).toBe(true);
    expect(assessment.status).toBe('supported');
    expect(assessment.unsupportedRequirements).toHaveLength(0);
  });

  it('marks reauth flows with reauth capability in discovered items', () => {
    const reauthFlow: FlowProgress = {
      flow_id: 'flow-tuya-reauth',
      handler: 'tuya',
      context: {
        source: 'reauth',
        entry_id: 'tuya-entry-1',
      },
    };

    const assessment = evaluateFlowProgress(reauthFlow, { serverUrl: haServerUrl });
    expect(assessment.status).toBe('supported-reauth');
    expect(assessment.requiresReauth).toBe(true);
    expect(assessment.supported).toBe(true);
  });

  it('identifies hardware-bound flows and prevents invalid local configuration', () => {
    const profile = getIntegrationFlowProfile('bluetooth');
    expect(profile.defaultSupport).toBe('unsupported');
    expect(profile.authMethod).toBe('hardware');

    const btProgress: FlowProgress = {
      flow_id: 'flow-bt-fail',
      handler: 'bluetooth',
    };

    const assessment = evaluateFlowProgress(btProgress, { serverUrl: haServerUrl });
    expect(assessment.supported).toBe(false);
    expect(assessment.status).toBe('unsupported');
    expect(assessment.fallbackReason).toContain('BlueZ');
  });
});
