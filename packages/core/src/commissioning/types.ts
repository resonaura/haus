/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { HausDevice } from '../device/types.js';

export type OnboardingKind =
  'matter-qr' | 'matter-manual' | 'homekit-uri' | 'homekit-pin' | 'improv' | 'vendor';

export type CommissioningProtocol = 'matter' | 'homekit' | 'improv' | 'vendor';

export type CommissioningState =
  | 'PARSE_CODE'
  | 'LAN_DISCOVERY'
  | 'RADIO_DISCOVERY'
  | 'SELECT_CANDIDATE'
  | 'OBTAIN_NETWORK_CREDENTIALS'
  | 'SECURE_CHANNEL'
  | 'NETWORK_PROVISION'
  | 'WAIT_FOR_IP'
  | 'FINAL_PAIR'
  | 'VERIFY'
  | 'DONE'
  | 'CANCELLED'
  | 'FAILED';

export type CommissioningEventType =
  | 'commission.create'
  | 'commission.code.parsed'
  | 'discovery.lan.started'
  | 'discovery.radio.started'
  | 'device.candidate'
  | 'device.identified'
  | 'commission.candidate.selected'
  | 'network.credentials.required'
  | 'network.credentials.provided'
  | 'secure_session.started'
  | 'network.provisioning'
  | 'network.provisioned'
  | 'homekit.classified'
  | 'improv.authorization_required'
  | 'improv.authorized'
  | 'device.ip.discovered'
  | 'controller.pairing'
  | 'controller.verified'
  | 'commission.resumed'
  | 'commission.cancelled'
  | 'commission.deadline.exceeded'
  | 'commission.step.retried'
  | 'commission.completed'
  | 'commission.failed';

export type RadioAgentPlatform = 'hub' | 'macos' | 'windows' | 'linux' | 'ios' | 'android';

export interface MatterOnboardingPayload {
  readonly raw: string;
  readonly passcode: number;
  readonly discriminator: {
    readonly value: number;
    readonly type: 'short' | 'long';
  };
  readonly vendorId?: number;
  readonly productId?: number;
  readonly commissioningFlow?: number;
  readonly discoveryCapabilities?: {
    readonly softAp?: boolean;
    readonly ble?: boolean;
    readonly onNetwork?: boolean;
  };
}

export interface HomeKitOnboardingPayload {
  readonly raw: string;
  readonly pin: string;
  readonly setupId?: string;
  readonly category?: number;
  readonly flags?: {
    readonly ip: boolean;
    readonly ble: boolean;
    readonly wac: boolean;
  };
}

export type HomeKitAccessoryClassification =
  | 'hap-ip'
  | 'hap-ble'
  | 'vendor-wifi-ble'
  | 'wac-only'
  | 'vendor-softap';

export interface HomeKitClassificationInfo {
  readonly classification: HomeKitAccessoryClassification;
  readonly description: string;
  readonly canDirectCommission: boolean;
  readonly requiresWifiCredentials: boolean;
  readonly guidance: string;
}

export interface ImprovOnboardingPayload {
  readonly raw: string;
  readonly deviceNameHint?: string;
  readonly transport?: 'ble' | 'serial';
  readonly serialPort?: string;
}

export interface VendorOnboardingPayload {
  readonly raw: string;
  readonly vendor: string;
  readonly identifier?: string;
  readonly model?: string;
  readonly address?: string;
  readonly port?: number;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface ParseSetupCodeOptions {
  readonly contextProtocol?: CommissioningProtocol;
}

export interface ParsedSetupCode {
  readonly kind: OnboardingKind;
  readonly raw: string;
  readonly protocol: CommissioningProtocol;
  readonly matter?: MatterOnboardingPayload;
  readonly homekit?: HomeKitOnboardingPayload;
  readonly improv?: ImprovOnboardingPayload;
  readonly vendor?: VendorOnboardingPayload;
}

export interface WifiCredentials {
  readonly ssid: string;
  readonly password: string;
}

export interface ScanRequest {
  readonly commissioningId: string;
  readonly kind: OnboardingKind;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  readonly matterDiscriminator?: {
    readonly value: number;
    readonly type: 'short' | 'long';
  };
  readonly homekitSetupId?: string;
  readonly serviceUuids?: readonly string[];
}

export interface Advertisement {
  readonly agentId: string;
  readonly transport: 'lan' | 'ble' | 'softap' | 'serial';
  readonly protocol: CommissioningProtocol;
  readonly identifier: string;
  readonly name: string;
  readonly rssi?: number;
  readonly address?: string;
  readonly port?: number;
  readonly discriminator?: number;
  readonly setupHash?: string;
  readonly paired?: boolean;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface RadioDevice {
  readonly agentId: string;
  readonly identifier: string;
  readonly transport: 'ble' | 'softap' | 'serial';
}

export interface RadioConnection {
  readonly device: RadioDevice;
  writeCharacteristic(
    serviceUuid: string,
    characteristicUuid: string,
    data: Uint8Array,
  ): Promise<void>;
  readCharacteristic(serviceUuid: string, characteristicUuid: string): Promise<Uint8Array>;
  subscribeCharacteristic(
    serviceUuid: string,
    characteristicUuid: string,
    listener: (data: Uint8Array) => void,
  ): Promise<() => void>;
  close(): Promise<void>;
}

export interface RadioAgent {
  readonly id: string;
  readonly platform: RadioAgentPlatform;
  scan(request: ScanRequest): AsyncIterable<Advertisement>;
  connect(device: RadioDevice): Promise<RadioConnection>;
}

export interface NetworkCredentialProvider {
  currentSsid(): Promise<string | undefined>;
  wifiCredentials(): Promise<WifiCredentials | undefined>;
  threadDataset(): Promise<Uint8Array | undefined>;
}

export interface CommissioningEvent {
  readonly seq: number;
  readonly timestamp: number;
  readonly type: CommissioningEventType;
  readonly state: CommissioningState;
  readonly message: string;
  readonly detail?: Readonly<Record<string, unknown>>;
}

export interface RequiredCredentialsPrompt {
  readonly kind: 'wifi' | 'thread';
  readonly suggestedSsid?: string;
  readonly reason: string;
}

export interface CommissioningTransaction {
  readonly commissioningId: string;
  readonly homeId?: string;
  readonly hubId?: string;
  readonly userId?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly deadlineTimestamp?: number;
  readonly activeOwner?: string;
  readonly state: CommissioningState;
  readonly parsedCode: ParsedSetupCode;
  readonly candidates: readonly Advertisement[];
  readonly selectedCandidate?: Advertisement;
  readonly requiresCredentials?: RequiredCredentialsPrompt;
  readonly events: readonly CommissioningEvent[];
  readonly pairedDevices?: readonly HausDevice[];
  readonly error?: string;
}

export interface CommissioningContext {
  readonly commissioningId: string;
  readonly homeId?: string;
  readonly parsedCode: ParsedSetupCode;
  readonly candidate?: Advertisement;
  readonly wifiCredentials?: WifiCredentials;
  readonly threadDataset?: Uint8Array;
  readonly targetAddress?: string;
  readonly targetPort?: number;
  readonly targetAccessoryId?: string;
  readonly targetName?: string;
  readonly abortSignal?: AbortSignal;
  emit(
    type: CommissioningEventType,
    state: CommissioningState,
    message: string,
    detail?: Record<string, unknown>,
  ): void;
}

export interface CommissioningResult {
  readonly status: 'completed' | 'credentials_required' | 'failed';
  readonly devices?: readonly HausDevice[];
  readonly requiresCredentials?: RequiredCredentialsPrompt;
  readonly error?: string;
  readonly detail?: Readonly<Record<string, unknown>>;
}

export interface CommissioningAdapter {
  readonly name: string;
  canHandle(code: ParsedSetupCode): boolean;
  commission(ctx: CommissioningContext): Promise<CommissioningResult>;
}
