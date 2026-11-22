/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

export type TerminalServiceManager = 'pm2' | 'systemd';

export type TerminalTarget =
  | { readonly kind: 'shell' }
  | { readonly kind: 'hub-logs'; readonly tail?: number }
  | { readonly kind: 'docker-logs'; readonly containerId: string; readonly tail?: number }
  | { readonly kind: 'docker-exec'; readonly containerId: string }
  | {
      readonly kind: 'service-logs';
      readonly manager: TerminalServiceManager;
      readonly serviceId: string;
      readonly tail?: number;
    }
  | { readonly kind: 'app-logs'; readonly appId: string; readonly tail?: number }
  | { readonly kind: 'app-exec'; readonly appId: string };

const DOCKER_CONTAINER_ID_RE = /^[a-f0-9]{12,64}$/i;
const SERVICE_ID_RE = /^[A-Za-z0-9@_.:\\-]{1,160}$/;
const APP_ID_RE = /^[A-Za-z0-9_.:-]{1,160}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateTail(raw: unknown): number | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1 || raw > 2000) {
    throw Error('invalid_terminal_tail');
  }
  return raw;
}

function validateDockerContainerId(raw: unknown): string {
  if (typeof raw !== 'string' || !DOCKER_CONTAINER_ID_RE.test(raw)) {
    throw Error('invalid_terminal_container_id');
  }
  return raw.toLowerCase();
}

function validateServiceId(raw: unknown): string {
  if (typeof raw !== 'string' || raw.startsWith('-') || !SERVICE_ID_RE.test(raw)) {
    throw Error('invalid_terminal_service_id');
  }
  return raw;
}

function validateAppId(raw: unknown): string {
  if (typeof raw !== 'string' || raw.startsWith('-') || !APP_ID_RE.test(raw)) {
    throw Error('invalid_terminal_app_id');
  }
  return raw;
}

/** Validates the requested target for a direct E2EE terminal or live-log stream. */
export function validateTerminalTarget(raw: unknown): TerminalTarget {
  if (raw === undefined || raw === null) return { kind: 'shell' };
  if (!isRecord(raw) || typeof raw.kind !== 'string') {
    throw Error('invalid_terminal_target');
  }
  switch (raw.kind) {
    case 'shell':
      return { kind: 'shell' };
    case 'hub-logs': {
      const tail = validateTail(raw.tail);
      return tail !== undefined ? { kind: 'hub-logs', tail } : { kind: 'hub-logs' };
    }
    case 'docker-logs': {
      const containerId = validateDockerContainerId(raw.containerId);
      const tail = validateTail(raw.tail);
      return tail !== undefined
        ? { kind: 'docker-logs', containerId, tail }
        : { kind: 'docker-logs', containerId };
    }
    case 'docker-exec':
      return { kind: 'docker-exec', containerId: validateDockerContainerId(raw.containerId) };
    case 'service-logs': {
      if (raw.manager !== 'pm2' && raw.manager !== 'systemd') {
        throw Error('invalid_terminal_service_manager');
      }
      const serviceId = validateServiceId(raw.serviceId);
      const tail = validateTail(raw.tail);
      return tail !== undefined
        ? { kind: 'service-logs', manager: raw.manager, serviceId, tail }
        : { kind: 'service-logs', manager: raw.manager, serviceId };
    }
    case 'app-logs': {
      const appId = validateAppId(raw.appId);
      const tail = validateTail(raw.tail);
      return tail !== undefined ? { kind: 'app-logs', appId, tail } : { kind: 'app-logs', appId };
    }
    case 'app-exec':
      return { kind: 'app-exec', appId: validateAppId(raw.appId) };
    default:
      throw Error('invalid_terminal_target');
  }
}

export function isReadOnlyTerminalTarget(target: TerminalTarget | undefined): boolean {
  if (!target) return false;
  return (
    target.kind === 'hub-logs' ||
    target.kind === 'docker-logs' ||
    target.kind === 'service-logs' ||
    target.kind === 'app-logs'
  );
}
