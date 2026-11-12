/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type {
  Advertisement,
  CommissioningEvent,
  CommissioningProtocol,
  CommissioningTransaction,
  OnboardingKind,
  ParsedSetupCode,
  RequiredCredentialsPrompt,
} from '@haus/core';

export type DetectedProtocolKind =
  | OnboardingKind
  | 'unsupported_proprietary'
  | 'ambiguous'
  | 'incomplete'
  | 'invalid';

export interface DetectedProtocol {
  readonly valid: boolean;
  readonly kind: DetectedProtocolKind;
  readonly protocol?: CommissioningProtocol;
  readonly label: string;
  readonly description: string;
  readonly badgeVariant: 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'danger';
  readonly parsed?: ParsedSetupCode;
  readonly honestLimitation?: string;
  readonly error?: string;
}

export type CommissioningUiStage =
  | 'code_entry'
  | 'candidate_selection'
  | 'credentials'
  | 'pairing'
  | 'complete'
  | 'error';

export interface CommissioningUiProgressStep {
  readonly key: string;
  readonly label: string;
  readonly status: 'pending' | 'in_progress' | 'completed' | 'failed';
}

export interface CommissioningSessionHook {
  readonly stage: CommissioningUiStage;
  readonly transaction: CommissioningTransaction | null;
  readonly detected: DetectedProtocol;
  readonly events: readonly CommissioningEvent[];
  readonly candidates: readonly Advertisement[];
  readonly selectedCandidate: Advertisement | null;
  readonly promptCredentials: RequiredCredentialsPrompt | null;
  readonly isSubmitting: boolean;
  readonly errorMessage: string | null;
  readonly actionableHint: string | null;
  readonly setCode: (code: string) => void;
  readonly rawCode: string;
  readonly startCommissioning: () => Promise<void>;
  readonly selectCandidate: (candidateId: string) => Promise<void>;
  readonly submitCredentials: (
    ssid: string,
    password: string,
    threadDataset?: string,
    saveForReuse?: boolean,
  ) => Promise<void>;
  readonly submitManualAddress: (address: string, port?: number) => Promise<void>;
  readonly cancelCommissioning: () => Promise<void>;
  readonly retry: () => void;
}
