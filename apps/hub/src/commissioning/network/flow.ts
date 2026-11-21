/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { randomBytes } from 'node:crypto';
import type { FlowDomainHandler, FlowFormField, IntegrationFlowStep } from '@haus/core';
import {
  GENERIC_NETWORK_DOMAIN,
  NETWORK_DEVICE_TYPE_OPTIONS,
  isNetworkDeviceType,
  networkDeviceTypeLabel,
  normalizeNetworkDeviceTarget,
  type NetworkDeviceType,
} from './types.js';

interface NetworkFlowValues {
  readonly name?: string;
  readonly device_type?: NetworkDeviceType;
  readonly host?: string;
  readonly scheme?: 'http' | 'https';
  readonly port?: number;
}

function buildSchema(defaults: NetworkFlowValues): FlowFormField[] {
  return [
    {
      name: 'name',
      type: 'string',
      label: 'Device name',
      required: true,
      placeholder: 'Main Router',
      ...(defaults.name ? { defaultValue: defaults.name } : {}),
    },
    {
      name: 'device_type',
      type: 'select',
      label: 'Device type',
      required: true,
      defaultValue: defaults.device_type ?? 'router',
      options: NETWORK_DEVICE_TYPE_OPTIONS.map((opt) => ({ value: opt.value, label: opt.label })),
    },
    {
      name: 'host',
      type: 'string',
      label: 'IP address or hostname',
      required: true,
      placeholder: '192.168.1.1',
      description: 'Enter the LAN IP address, hostname, or full http(s):// web admin URL.',
      ...(defaults.host ? { defaultValue: defaults.host } : {}),
    },
    {
      name: 'scheme',
      type: 'select',
      label: 'Protocol',
      required: true,
      defaultValue: defaults.scheme ?? 'http',
      options: [
        { value: 'http', label: 'HTTP' },
        { value: 'https', label: 'HTTPS' },
      ],
    },
    {
      name: 'port',
      type: 'integer',
      label: 'Port (optional)',
      required: false,
      min: 1,
      max: 65535,
      description: 'Leave empty to use default port (80 for HTTP, 443 for HTTPS).',
      ...(defaults.port !== undefined ? { defaultValue: defaults.port } : {}),
    },
  ];
}

function extractDefaults(raw?: Readonly<Record<string, unknown>>): NetworkFlowValues {
  if (!raw) return {};
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : undefined;
  const device_type = isNetworkDeviceType(raw.device_type) ? raw.device_type : undefined;
  const host = typeof raw.host === 'string' && raw.host.trim() ? raw.host.trim() : undefined;
  const scheme = raw.scheme === 'https' || raw.scheme === 'http' ? raw.scheme : undefined;
  const rawPort = raw.port;
  const numPort =
    typeof rawPort === 'number'
      ? rawPort
      : typeof rawPort === 'string' && rawPort.trim()
        ? Number(rawPort)
        : undefined;
  const port =
    numPort !== undefined && Number.isInteger(numPort) && numPort >= 1 && numPort <= 65535
      ? numPort
      : undefined;
  return { name, device_type, host, scheme, port };
}

function buildFormStep(
  flowId: string,
  source: string,
  defaults: NetworkFlowValues,
  errors?: Record<string, string>,
): IntegrationFlowStep {
  const isEdit = source === 'reconfigure' || source === 'options';
  return {
    type: 'form',
    flowId,
    handler: GENERIC_NETWORK_DOMAIN,
    stepId: isEdit ? source : 'user',
    title: isEdit ? 'Configure Generic Network Device' : 'Add Generic Network Device',
    description:
      'Add a router, switch, repeater, access point, modem, firewall, or NAS by IP address. Clicking the device opens its web interface in your browser.',
    dataSchema: buildSchema(defaults),
    ...(errors ? { errors } : {}),
    lastStep: true,
  };
}

/** Creates the native config/reconfigure/options flow handler for `generic_network`. */
export function createGenericNetworkFlowHandler(): FlowDomainHandler {
  return {
    start: ({ flowId, source, options }) => {
      const defaults = extractDefaults(options.initialData);
      return buildFormStep(flowId, source, defaults);
    },
    submit: (session, submission) => {
      const raw = submission.values;
      const name = typeof raw.name === 'string' ? raw.name.trim() : '';
      const deviceType: NetworkDeviceType = isNetworkDeviceType(raw.device_type)
        ? raw.device_type
        : 'router';
      const scheme: 'http' | 'https' = raw.scheme === 'https' ? 'https' : 'http';
      const rawHost = typeof raw.host === 'string' ? raw.host.trim() : '';
      const rawPort = raw.port;

      const errors: Record<string, string> = {};
      if (!name) errors.name = 'required';
      const normalized = normalizeNetworkDeviceTarget({
        host: rawHost,
        scheme,
        port: rawPort,
      });
      if (!normalized.ok) {
        errors[normalized.field] = normalized.error;
      }

      if (Object.keys(errors).length > 0 || !normalized.ok) {
        return buildFormStep(
          session.flowId,
          session.source,
          {
            name: name || undefined,
            device_type: deviceType,
            host: rawHost || undefined,
            scheme,
            ...extractDefaults({ port: rawPort }),
          },
          errors,
        );
      }

      const target = normalized.target;
      const entryId = session.entryId ?? `entry_net_${randomBytes(6).toString('hex')}`;
      const payload: Record<string, unknown> = {
        name,
        device_type: deviceType,
        host: target.host,
        scheme: target.scheme,
        port: target.port ?? null,
        management_url: target.managementUrl,
      };
      const title = `${name} (${target.host})`;
      const label = networkDeviceTypeLabel(deviceType);

      return {
        type: 'create_entry',
        flowId: session.flowId,
        handler: GENERIC_NETWORK_DOMAIN,
        stepId: session.currentStep.stepId,
        title,
        description: `${label} at ${target.managementUrl}`,
        result: {
          entryId,
          title,
          uniqueId: `generic_network:${target.managementUrl}`,
          data: payload,
          options: payload,
        },
      };
    },
  };
}
