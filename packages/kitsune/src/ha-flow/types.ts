/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */

export interface HaFlowRuntimeOptions {
  readonly pythonBin?: string;
  readonly configDir?: string;
  readonly depsDir?: string;
  readonly frontendBase?: string;
  readonly componentsOverlayDir?: string;
  readonly autoInstallReqs?: boolean;
  readonly setupOnCreate?: boolean;
  readonly startupTimeoutMs?: number;
  readonly requestTimeoutMs?: number;
}

export interface HaSerializedFlowSchemaField {
  readonly name: string;
  readonly type?: string;
  readonly required?: boolean;
  readonly optional?: boolean;
  readonly default?: unknown;
  readonly description?: Record<string, unknown>;
  readonly selector?: Record<string, unknown>;
  readonly options?: readonly unknown[] | Record<string, string>;
  readonly schema?: readonly HaSerializedFlowSchemaField[];
  readonly expanded?: boolean;
  readonly valueMin?: number;
  readonly valueMax?: number;
  readonly value_min?: number;
  readonly value_max?: number;
  readonly multiple?: boolean;
  readonly custom?: boolean;
}

export interface HaRawFlowResult {
  readonly type: string;
  readonly flow_id?: string;
  readonly handler: string;
  readonly step_id?: string;
  readonly data_schema?: readonly HaSerializedFlowSchemaField[];
  readonly errors?: Record<string, string>;
  readonly description_placeholders?: Record<string, string>;
  readonly reason?: string;
  readonly url?: string;
  readonly menu_options?: readonly string[] | Record<string, string>;
  readonly last_step?: boolean | null;
  readonly progress_action?: string;
  readonly translation_domain?: string;
  readonly title?: string;
  readonly result?: Record<string, unknown>;
}

export interface HaCreatedConfigEntry {
  readonly entry_id: string;
  readonly domain: string;
  readonly title: string;
  readonly data: Record<string, unknown>;
  readonly options: Record<string, unknown>;
  readonly unique_id: string | null;
  readonly version: number;
  readonly minor_version: number;
  readonly source: string;
}

export interface HaLocalizedFlowStrings {
  readonly title: string;
  readonly integrationTitle: string;
  readonly flowTitle: string | null;
  readonly stepTitle: string | null;
  readonly description: string | null;
  readonly submitLabel: string | null;
  readonly fieldLabels: Readonly<Record<string, string>>;
  readonly dataDescriptions: Readonly<Record<string, string>>;
  readonly errors: Readonly<Record<string, string>>;
  readonly abortReason: string | null;
  readonly menuOptions: Readonly<Record<string, string>>;
  readonly menuOptionDescriptions: Readonly<Record<string, string>>;
  readonly selectorTranslations: Readonly<Record<string, string>>;
  readonly supportedBy: string | null;
}

export interface HaFlowStepEnvelope {
  readonly invalidData?: boolean;
  readonly errors?: Readonly<Record<string, string>>;
  readonly flowResult?: HaRawFlowResult;
  readonly entry?: HaCreatedConfigEntry | null;
  readonly localized?: HaLocalizedFlowStrings;
  readonly context?: Readonly<Record<string, unknown>>;
}

export interface HaFlowProgressItem {
  readonly flow_id: string;
  readonly handler: string;
  readonly step_id?: string;
  readonly context: {
    readonly source?: string;
    readonly entry_id?: string;
    readonly title_placeholders?: Readonly<Record<string, string>>;
    readonly [key: string]: unknown;
  };
  readonly title: string;
}

export interface HaSyncEntryInput {
  readonly entryId: string;
  readonly domain: string;
  readonly title: string;
  readonly data: Record<string, unknown>;
  readonly options?: Record<string, unknown>;
  readonly uniqueId?: string | null;
  readonly version?: number;
  readonly minorVersion?: number;
  readonly source?: string;
  readonly disabledBy?: string | null;
}

export interface HaSyncCredentialInput {
  readonly domain: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly authDomain?: string;
  readonly name?: string;
}

export interface HaSyncStateInput {
  readonly frontendBase?: string;
  readonly setupOnCreate?: boolean;
  readonly entries?: readonly HaSyncEntryInput[];
  readonly areas?: readonly { readonly name: string }[];
  readonly applicationCredentials?: readonly HaSyncCredentialInput[];
}

export interface HaDiscoveryTriggerResult extends HaFlowStepEnvelope {
  readonly outcome: string;
}

export interface HaFlowHealth {
  readonly ok: boolean;
  readonly pythonVersion: string;
  readonly haVersion: string;
  readonly depsDir: string;
  readonly autoInstallReqs: boolean;
  readonly entriesCount: number;
}
