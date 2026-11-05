/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { describe, expect, it } from 'vitest';
import {
  evaluateFlowProgress,
  evaluateFlowStep,
  getIntegrationFlowProfile,
  type FlowProgress,
  type FlowStep,
} from '../src/flow/index.js';

describe('Home Assistant Config Flow Support Matrix and Capability Evaluation', () => {
  it('classifies standard integrations in the support matrix', () => {
    // Form-based local integrations
    expect(getIntegrationFlowProfile('mqtt').defaultSupport).toBe('supported');
    expect(getIntegrationFlowProfile('generic').defaultSupport).toBe('supported');
    expect(getIntegrationFlowProfile('shelly').defaultSupport).toBe('supported');
    expect(getIntegrationFlowProfile('homekit_controller').defaultSupport).toBe('supported');
    expect(getIntegrationFlowProfile('zha').defaultSupport).toBe('supported');

    // OAuth / Browser integrations
    expect(getIntegrationFlowProfile('spotify').defaultSupport).toBe('supported-oauth');
    expect(getIntegrationFlowProfile('nest').defaultSupport).toBe('supported-oauth');
    expect(getIntegrationFlowProfile('google').defaultSupport).toBe('supported-oauth');
    expect(getIntegrationFlowProfile('tesla').defaultSupport).toBe('supported-oauth');

    // Hardware / Supervisor unsupported integrations
    expect(getIntegrationFlowProfile('bluetooth').defaultSupport).toBe('unsupported');
    expect(getIntegrationFlowProfile('zwave_js').defaultSupport).toBe('unsupported');
    expect(getIntegrationFlowProfile('usb').defaultSupport).toBe('unsupported');
    expect(getIntegrationFlowProfile('hassio').defaultSupport).toBe('unsupported');

    // Dynamic fallback for unlisted integration
    const unlisted = getIntegrationFlowProfile('custom_widget');
    expect(unlisted.domain).toBe('custom_widget');
    expect(unlisted.title).toBe('Custom Widget');
    expect(unlisted.defaultSupport).toBe('supported');
  });

  it('evaluates form steps with supported selectors as supported', () => {
    const supportedStep: FlowStep = {
      type: 'form',
      flow_id: 'flow-abc-123',
      handler: 'mqtt',
      step_id: 'broker',
      data_schema: [
        { name: 'broker', type: 'string', required: true },
        { name: 'port', type: 'integer', default: 1883 },
        { name: 'discovery', type: 'boolean', default: true },
        { name: 'protocol', selector: { select: { options: ['3.1', '3.1.1', '5'] } } },
        { name: 'client_cert', selector: { text: {} } },
        { name: 'target_entity', selector: { entity: { domain: 'sensor' } } },
        { name: 'target_device', selector: { device: {} } },
        { name: 'target_area', selector: { area: {} } },
      ],
    };

    const assessment = evaluateFlowStep(supportedStep, { serverUrl: 'http://ha.local:8123' });
    expect(assessment.supported).toBe(true);
    expect(assessment.status).toBe('supported');
    expect(assessment.unsupportedRequirements).toHaveLength(0);
  });

  it('evaluates nested form schemas correctly', () => {
    const nestedStep: FlowStep = {
      type: 'form',
      flow_id: 'flow-nested-1',
      handler: 'generic',
      step_id: 'advanced',
      data_schema: [
        {
          name: 'advanced_options',
          schema: [
            { name: 'framerate', type: 'integer' },
            { name: 'verify_ssl', type: 'boolean' },
          ],
        },
      ],
    };

    const assessment = evaluateFlowStep(nestedStep);
    expect(assessment.supported).toBe(true);
    expect(assessment.status).toBe('supported');
  });

  it('detects unsupported custom selectors and provides honest fallback guidance', () => {
    const unsupportedStep: FlowStep = {
      type: 'form',
      flow_id: 'flow-addon-999',
      handler: 'my_integration',
      step_id: 'user',
      data_schema: [
        { name: 'host', type: 'string' },
        { name: 'addon_slug', selector: { addon: {} } }, // Unsupported selector
        { name: 'map_coordinates', selector: { location: {} } }, // Unsupported selector
      ],
    };

    const assessment = evaluateFlowStep(unsupportedStep, {
      serverUrl: 'http://homeassistant.local:8123',
    });

    expect(assessment.supported).toBe(false);
    expect(assessment.status).toBe('unsupported');
    expect(assessment.unsupportedRequirements).toHaveLength(2);
    expect(assessment.unsupportedRequirements[0].name).toBe('addon');
    expect(assessment.unsupportedRequirements[1].name).toBe('location');
    expect(assessment.fallbackUrl).toBe(
      'http://homeassistant.local:8123/config/config_entries/flow/flow-addon-999',
    );
    expect(assessment.fallbackReason).toContain('addon, location');
  });

  it('identifies external OAuth steps', () => {
    const externalStep: FlowStep = {
      type: 'external',
      flow_id: 'flow-spotify-1',
      handler: 'spotify',
      step_id: 'auth',
      url: 'https://accounts.spotify.com/authorize?...',
    };

    const assessment = evaluateFlowStep(externalStep);
    expect(assessment.supported).toBe(true);
    expect(assessment.status).toBe('supported-oauth');
    expect(assessment.requiresOAuth).toBe(true);
  });

  it('flags unsupported step types with fallback URL', () => {
    const weirdStep: FlowStep = {
      type: 'unrecognized_custom_step',
      flow_id: 'flow-weird-1',
      handler: 'custom_cloud',
      step_id: 'weird',
    };

    const assessment = evaluateFlowStep(weirdStep, { serverUrl: 'http://192.168.1.10:8123' });
    expect(assessment.supported).toBe(false);
    expect(assessment.status).toBe('unsupported');
    expect(assessment.unsupportedRequirements[0].category).toBe('step_type');
    expect(assessment.fallbackUrl).toBe(
      'http://192.168.1.10:8123/config/config_entries/flow/flow-weird-1',
    );
  });

  it('rejects hardware-dependent integrations with honest fallback explanation', () => {
    const btStep: FlowStep = {
      type: 'form',
      flow_id: 'flow-bt-1',
      handler: 'bluetooth',
      step_id: 'init',
      data_schema: [{ name: 'adapter', type: 'string' }],
    };

    const assessment = evaluateFlowStep(btStep);
    expect(assessment.supported).toBe(false);
    expect(assessment.status).toBe('unsupported');
    expect(assessment.unsupportedRequirements[0].category).toBe('hardware');
    expect(assessment.fallbackReason).toContain('BlueZ daemon');
  });

  it('evaluates flow progress for reauth, OAuth, and unsupported flows', () => {
    const reauthFlow: FlowProgress = {
      flow_id: 'flow-reauth-1',
      handler: 'tuya',
      context: { source: 'reauth', entry_id: 'entry-123' },
    };
    const assessmentReauth = evaluateFlowProgress(reauthFlow);
    expect(assessmentReauth.status).toBe('supported-reauth');
    expect(assessmentReauth.requiresReauth).toBe(true);

    const oauthFlow: FlowProgress = {
      flow_id: 'flow-oauth-1',
      handler: 'nest',
      context: { source: 'discovery' },
    };
    const assessmentOauth = evaluateFlowProgress(oauthFlow);
    expect(assessmentOauth.status).toBe('supported-oauth');
    expect(assessmentOauth.requiresOAuth).toBe(true);

    const unsupportedFlow: FlowProgress = {
      flow_id: 'flow-bt-progress',
      handler: 'bluetooth',
    };
    const assessmentUnsupported = evaluateFlowProgress(unsupportedFlow);
    expect(assessmentUnsupported.status).toBe('unsupported');
    expect(assessmentUnsupported.supported).toBe(false);
  });
});
