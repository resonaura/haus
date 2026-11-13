/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { randomBytes } from 'node:crypto';
import type { FlowDomainHandler, FlowFormField, IntegrationFlowStep } from '@haus/core';
import type { TuyaClient } from './client.js';
import type { TuyaStoredCredentials } from './types.js';

export const TUYA_DOCS_URL = 'https://www.home-assistant.io/integrations/tuya/';
const FLOW_TTL_MS = 30 * 60_000;

export interface TuyaFlowSessionState {
  readonly mode: 'user' | 'reauth' | 'reconfigure';
  readonly entryId?: string;
  readonly updatedAt: number;
  userCode?: string;
  qrToken?: string;
}

export interface PendingTuyaAuthorization {
  readonly entryId: string;
  readonly credentials: TuyaStoredCredentials;
}

function buildUserCodeSchema(defaultCode?: string): FlowFormField[] {
  return [
    {
      name: 'user_code',
      type: 'string',
      label: 'User code',
      required: true,
      ...(defaultCode ? { defaultValue: defaultCode } : {}),
    },
  ];
}

function buildScanSchema(qrToken: string): FlowFormField[] {
  const qrData = `tuyaSmart--qrLogin?token=${qrToken}`;
  return [
    {
      name: 'QR',
      type: 'qr_code',
      label: 'QR code',
      required: false,
      defaultValue: qrData,
      selector: {
        qr_code: {
          data: qrData,
          scale: 5,
          error_correction_level: 'Q',
        },
      },
    },
  ];
}

function buildUserStep(
  flowId: string,
  stepId: 'user' | 'reauth_user_code',
  options?: {
    defaultCode?: string;
    errors?: Record<string, string>;
    descriptionPlaceholders?: Record<string, string>;
  },
): IntegrationFlowStep {
  return {
    type: 'form',
    flowId,
    handler: 'tuya',
    stepId,
    title: 'Tuya',
    description:
      stepId === 'reauth_user_code'
        ? 'To reauthenticate with your Smart Life or Tuya Smart account, enter your case-sensitive User Code found in **Settings > Account and Security**.'
        : 'Enter your Smart Life or Tuya Smart user code.\n\nYou can find this code in the Smart Life app or Tuya Smart app in **Settings > Account and Security** screen, and enter the code shown on the **User Code** field. The user code is case-sensitive, please be sure to enter it exactly as shown in the app.',
    documentationUrl: TUYA_DOCS_URL,
    dataSchema: buildUserCodeSchema(options?.defaultCode),
    ...(options?.errors ? { errors: options.errors } : {}),
    ...(options?.descriptionPlaceholders
      ? { descriptionPlaceholders: options.descriptionPlaceholders }
      : {}),
    lastStep: false,
  };
}

function buildScanStep(
  flowId: string,
  qrToken: string,
  options?: {
    errors?: Record<string, string>;
    descriptionPlaceholders?: Record<string, string>;
  },
): IntegrationFlowStep {
  return {
    type: 'form',
    flowId,
    handler: 'tuya',
    stepId: 'scan',
    title: 'Tuya',
    description:
      'Use the Smart Life app or Tuya Smart app to scan the following QR code to complete the login.\n\nContinue to the next step once you have completed this step in the app.',
    documentationUrl: TUYA_DOCS_URL,
    dataSchema: buildScanSchema(qrToken),
    ...(options?.errors ? { errors: options.errors } : {}),
    ...(options?.descriptionPlaceholders
      ? { descriptionPlaceholders: options.descriptionPlaceholders }
      : {}),
    lastStep: true,
  };
}

/** Builds a HA-matching multi-step QR login FlowDomainHandler backed by Tuya Cloud endpoints. */
export function createTuyaFlowHandler(deps: {
  readonly getClient: () => TuyaClient;
  readonly flowStates: Map<string, TuyaFlowSessionState>;
  readonly pendingCredentials: Map<string, PendingTuyaAuthorization>;
}): FlowDomainHandler {
  const pruneStaleFlows = () => {
    const cutoff = Date.now() - FLOW_TTL_MS;
    for (const [id, state] of deps.flowStates) {
      if (state.updatedAt < cutoff) {
        deps.flowStates.delete(id);
        deps.pendingCredentials.delete(id);
      }
    }
  };

  return {
    start: async ({ flowId, source, options }) => {
      if (source === 'options') return undefined;
      pruneStaleFlows();

      const prefill =
        typeof options.initialData?.user_code === 'string'
          ? options.initialData.user_code.trim()
          : '';
      const targetEntryId = options.entryId ?? options.reauthEntryId;

      if (source === 'reauth') {
        if (prefill) {
          deps.flowStates.set(flowId, {
            mode: 'reauth',
            entryId: targetEntryId,
            userCode: prefill,
            updatedAt: Date.now(),
          });
          return {
            type: 'form',
            flowId,
            handler: 'tuya',
            stepId: 'reauth_confirm',
            title: 'Reauthenticate Tuya',
            description:
              'Your Smart Life or Tuya Smart account needs to be reauthenticated.\n\nSelect **Submit** to get a QR code to scan with the app.',
            documentationUrl: TUYA_DOCS_URL,
            dataSchema: [],
            lastStep: false,
          };
        }
        deps.flowStates.set(flowId, {
          mode: 'reauth',
          entryId: targetEntryId,
          updatedAt: Date.now(),
        });
        return buildUserStep(flowId, 'reauth_user_code');
      }

      deps.flowStates.set(flowId, {
        mode: source === 'reconfigure' ? 'reconfigure' : 'user',
        entryId: source === 'reconfigure' ? targetEntryId : undefined,
        ...(prefill ? { userCode: prefill } : {}),
        updatedAt: Date.now(),
      });
      return buildUserStep(flowId, 'user', prefill ? { defaultCode: prefill } : undefined);
    },

    submit: async (session, submission) => {
      if (session.source === 'options') return undefined;
      const client = deps.getClient();
      const stepId = submission.stepId ?? session.currentStep.stepId;
      const state = deps.flowStates.get(session.flowId) ?? {
        mode:
          session.source === 'reauth'
            ? 'reauth'
            : session.source === 'reconfigure'
              ? 'reconfigure'
              : 'user',
        entryId: session.entryId,
        updatedAt: Date.now(),
      };

      if (stepId === 'reauth_confirm') {
        const userCode = state.userCode?.trim() ?? '';
        if (!userCode) {
          return buildUserStep(session.flowId, 'reauth_user_code');
        }
        const qr = await client.requestQrCode(userCode);
        if (!qr.success || !qr.qrcode) {
          return buildUserStep(session.flowId, 'reauth_user_code', {
            defaultCode: userCode,
            errors: { base: 'login_error' },
            descriptionPlaceholders: {
              code: String(qr.code ?? '0'),
              msg: qr.msg ?? 'Unknown error',
            },
          });
        }
        deps.flowStates.set(session.flowId, {
          ...state,
          userCode,
          qrToken: qr.qrcode,
          updatedAt: Date.now(),
        });
        return buildScanStep(session.flowId, qr.qrcode);
      }

      if (stepId === 'user' || stepId === 'reauth_user_code') {
        const raw =
          typeof submission.values.user_code === 'string' ? submission.values.user_code : '';
        const userCode = raw.trim();
        if (!userCode) {
          return buildUserStep(session.flowId, stepId, {
            errors: { user_code: 'required' },
          });
        }
        const qr = await client.requestQrCode(userCode);
        if (!qr.success || !qr.qrcode) {
          return buildUserStep(session.flowId, stepId, {
            defaultCode: userCode,
            errors: { base: 'login_error' },
            descriptionPlaceholders: {
              code: String(qr.code ?? '0'),
              msg: qr.msg ?? 'Unknown error',
            },
          });
        }
        deps.flowStates.set(session.flowId, {
          ...state,
          userCode,
          qrToken: qr.qrcode,
          updatedAt: Date.now(),
        });
        return buildScanStep(session.flowId, qr.qrcode);
      }

      if (stepId === 'scan') {
        const userCode = state.userCode?.trim();
        let qrToken = state.qrToken;
        if (!userCode || !qrToken) {
          return buildUserStep(session.flowId, 'user', {
            errors: { base: 'login_error' },
            descriptionPlaceholders: {
              code: 'session_expired',
              msg: 'QR login session expired. Enter your User Code again.',
            },
          });
        }

        const poll = await client.pollLoginResult(qrToken, userCode);
        if (!poll.success || !poll.credentials) {
          const refreshedQr = await client.requestQrCode(userCode);
          if (refreshedQr.success && refreshedQr.qrcode) {
            qrToken = refreshedQr.qrcode;
            deps.flowStates.set(session.flowId, {
              ...state,
              qrToken,
              updatedAt: Date.now(),
            });
          }
          return buildScanStep(session.flowId, qrToken, {
            errors: { base: 'login_error' },
            descriptionPlaceholders: {
              code: String(poll.code ?? '0'),
              msg: poll.msg ?? 'Unknown error',
            },
          });
        }

        const entryId =
          state.entryId ??
          `entry_tuya_${poll.credentials.uid.slice(0, 12)}_${randomBytes(3).toString('hex')}`;
        const title = poll.credentials.username || `Tuya (${userCode})`;

        deps.pendingCredentials.set(session.flowId, {
          entryId,
          credentials: poll.credentials,
        });
        deps.flowStates.delete(session.flowId);

        return {
          type: 'create_entry',
          flowId: session.flowId,
          handler: 'tuya',
          stepId: 'scan',
          title,
          result: {
            entryId,
            title,
            data: {
              user_code: userCode,
              uid: poll.credentials.uid,
              endpoint: poll.credentials.endpoint,
              terminal_id: poll.credentials.terminal_id,
            },
          },
        };
      }

      return undefined;
    },
  };
}
