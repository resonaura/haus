/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { isRecord } from './record.js';
import { validateServiceOperation } from './helper-service-validation.js';
export interface HelperRequest {
  method: 'GET' | 'POST' | 'PATCH';
  path: string;
  data?: Record<string, unknown>;
}
export function validateHelperRequest(input: unknown): HelperRequest {
  if (
    !isRecord(input) ||
    !['GET', 'POST', 'PATCH'].includes(String(input.method)) ||
    typeof input.path !== 'string' ||
    input.path.length > 2048 ||
    JSON.stringify(input).length > 65536 ||
    !input.path.startsWith('/api/') ||
    input.path.includes('\\')
  )
    throw new Error('Invalid Haus service request.');
  const url = new URL(input.path, 'http://haus.invalid');
  const service = validateServiceOperation(input.method, url.pathname, input.data);
  const haIntegration = input.method === 'POST' && url.pathname === '/api/ha-integration';
  const camera = /^\/api\/cameras\/camera\.[a-z0-9_]+$/.test(url.pathname);
  const record = /^\/api\/cameras\/camera\.[a-z0-9_]+\/record$/.test(url.pathname);
  const homekit =
    input.method === 'POST' &&
    /^\/api\/cameras\/camera\.[a-z0-9_]+\/homekit(?:\/pair)?$/.test(url.pathname);
  const operating =
    input.method === 'POST' && /^\/api\/cameras\/camera\.[a-z0-9_]+\/operating$/.test(url.pathname);
  const read =
    input.method === 'GET' &&
    [
      '/api/availability',
      '/api/status',
      '/api/cameras',
      '/api/detectors',
      '/api/events',
      '/api/events/calendar',
    ].includes(url.pathname);
  if (
    url.origin !== 'http://haus.invalid' ||
    url.hash ||
    (!read &&
      !service &&
      !(
        input.method === 'GET' &&
        /^\/api\/events\/[a-f0-9-]{36}\/(prepare|prepare-next)$/.test(url.pathname)
      ) &&
      !(camera && input.method === 'PATCH') &&
      !(record && input.method === 'POST') &&
      !homekit &&
      !operating &&
      !haIntegration)
  )
    throw new Error('This Haus service operation is unavailable.');
  if (!['/api/events', '/api/events/calendar'].includes(url.pathname) && url.search)
    throw new Error('Invalid Haus service query.');
  for (const [key, value] of url.searchParams) {
    if (
      ![
        'camera_id',
        'from',
        'to',
        'cursor',
        'limit',
        'kind',
        'status',
        'direction',
        'boundaries',
      ].includes(key) ||
      value.length > 512
    )
      throw new Error('Invalid timeline filter.');
  }
  if (input.method === 'GET' && input.data !== undefined)
    throw new Error('Unexpected Haus service form.');
  if (
    !service &&
    input.method !== 'GET' &&
    (!isRecord(input.data) ||
      Object.keys(input.data).some(
        (key) =>
          !(
            haIntegration
              ? ['action', 'clientId']
              : homekit
                ? ['enabled', 'processor']
                : operating
                  ? ['control', 'entityId', 'value']
                  : ['enabled', 'sensorIds', 'motionDetection', 'talkback']
          ).includes(key),
      ))
  )
    throw new Error('Invalid camera settings.');
  if (!service && isRecord(input.data)) {
    if (
      operating &&
      (Object.keys(input.data).length !== 3 ||
        !['indicator', 'nightVision'].includes(String(input.data.control)) ||
        typeof input.data.entityId !== 'string' ||
        !/^(switch|light)\.[a-z0-9_]+$/.test(input.data.entityId) ||
        typeof input.data.value !== 'boolean')
    )
      throw new Error('Invalid camera operating control.');
    if (
      haIntegration &&
      !(
        (input.data.action === 'setup' && Object.keys(input.data).length === 1) ||
        (input.data.action === 'revoke' &&
          typeof input.data.clientId === 'string' &&
          /^[a-f0-9]{24}$/.test(input.data.clientId))
      )
    )
      throw new Error('Invalid Home Assistant camera integration request.');
    if (homekit) {
      const pair = url.pathname.endsWith('/pair');
      if (
        pair
          ? Object.keys(input.data).length !== 0
          : typeof input.data.enabled !== 'boolean' ||
            typeof input.data.processor !== 'string' ||
            !/^(auto|home|[a-f0-9-]{36})$/.test(input.data.processor)
      )
        throw new Error('Invalid Apple Home camera settings.');
    }
    if (input.data.talkback !== undefined && input.data.talkback !== null) {
      const target = input.data.talkback;
      if (
        !isRecord(target) ||
        Object.keys(target).length !== 1 ||
        !(
          (typeof target.entityId === 'string' &&
            /^(sensor|text|input_text)\.[a-z0-9_]+$/.test(target.entityId)) ||
          (typeof target.url === 'string' &&
            target.url.length <= 2048 &&
            target.url.startsWith('rtmp://'))
        )
      )
        throw new Error('Choose a valid camera microphone source.');
    }
    if (input.data.motionDetection !== undefined) {
      const motion = input.data.motionDetection;
      if (
        !isRecord(motion) ||
        Object.keys(motion).some((key) => !['enabled', 'mode'].includes(key)) ||
        typeof motion.enabled !== 'boolean' ||
        !['objects', 'motion'].includes(String(motion.mode))
      )
        throw new Error('Invalid motion recording settings.');
    }
    if (input.data.enabled !== undefined && typeof input.data.enabled !== 'boolean')
      throw new Error('Invalid camera recording state.');
    if (
      input.data.sensorIds !== undefined &&
      input.data.sensorIds !== null &&
      (!Array.isArray(input.data.sensorIds) ||
        input.data.sensorIds.length > 64 ||
        input.data.sensorIds.some(
          (id) => typeof id !== 'string' || !/^(binary_sensor|event)\.[a-z0-9_]+$/.test(id),
        ))
    )
      throw new Error('Invalid camera detectors.');
    if (record && Object.keys(input.data).length)
      throw new Error('Unexpected recording parameters.');
  }
  return {
    method: input.method as HelperRequest['method'],
    path: url.pathname + url.search,
    ...(input.data === undefined ? {} : { data: input.data as Record<string, unknown> }),
  };
}
