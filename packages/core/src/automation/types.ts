/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

export enum ExecutionModeEnum {
  Single = 'single',
  Restart = 'restart',
  Queued = 'queued',
  Parallel = 'parallel',
}

export const ExecutionMode = ExecutionModeEnum;
export type ExecutionMode = ExecutionModeEnum | `${ExecutionModeEnum}`;

export enum ExecutionStatusEnum {
  Running = 'running',
  Completed = 'completed',
  Failed = 'failed',
  Cancelled = 'cancelled',
  Partial = 'partial',
}

export const ExecutionStatus = ExecutionStatusEnum;
export type ExecutionStatus = ExecutionStatusEnum | `${ExecutionStatusEnum}`;

export enum StepStatusEnum {
  Pending = 'pending',
  Running = 'running',
  Completed = 'completed',
  Failed = 'failed',
  Skipped = 'skipped',
  TimedOut = 'timed_out',
  Cancelled = 'cancelled',
}

export const StepStatus = StepStatusEnum;
export type StepStatus = StepStatusEnum | `${StepStatusEnum}`;

export enum TriggerTypeEnum {
  State = 'state',
  Event = 'event',
  Time = 'time',
  NumericState = 'numeric_state',
}

export const TriggerType = TriggerTypeEnum;
export type TriggerType = TriggerTypeEnum | `${TriggerTypeEnum}`;

export enum StepTypeEnum {
  Action = 'action',
  Condition = 'condition',
  Delay = 'delay',
  Sequence = 'sequence',
  Parallel = 'parallel',
  Repeat = 'repeat',
  Choose = 'choose',
}

export const StepType = StepTypeEnum;
export type StepType = StepTypeEnum | `${StepTypeEnum}`;

export enum ConditionOperatorEnum {
  Equals = '==',
  NotEquals = '!=',
  GreaterThan = '>',
  LessThan = '<',
  GreaterThanOrEqual = '>=',
  LessThanOrEqual = '<=',
  In = 'in',
  NotIn = 'not_in',
}

export const ConditionOperator = ConditionOperatorEnum;
export type ConditionOperator = ConditionOperatorEnum | `${ConditionOperatorEnum}`;

// --- Scene Contracts ---

export interface SceneTargetState {
  readonly on_off?: boolean;
  readonly brightness?: number;
  readonly color_temp?: number;
  readonly color_hsv?: { readonly h: number; readonly s: number; readonly v: number };
  readonly cover_position?: number;
  readonly lock_state?: 'locked' | 'unlocked';
  readonly [key: string]: unknown;
}

export interface SceneMemberState {
  readonly endpointId: string;
  readonly targetState: SceneTargetState;
  readonly transitionSeconds?: number;
}

export interface HausScene {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly icon?: string;
  readonly roomId?: string;
  readonly members: readonly SceneMemberState[];
  readonly metadata?: Record<string, unknown>;
}

// --- Script & Action Contracts ---

export interface DeviceActionPayload {
  readonly endpointId: string;
  readonly capability: string;
  readonly command: string;
  readonly parameters?: Record<string, unknown>;
}

export interface SceneActionPayload {
  readonly sceneId: string;
}

export interface ScriptActionPayload {
  readonly scriptId: string;
  readonly parameters?: Record<string, unknown>;
}

export interface NotificationActionPayload {
  readonly title: string;
  readonly message: string;
  readonly priority?: 'normal' | 'high' | 'critical';
  readonly actionKeys?: readonly string[];
}

export type ScriptAction =
  | { readonly kind: 'device_command'; readonly payload: DeviceActionPayload }
  | { readonly kind: 'activate_scene'; readonly payload: SceneActionPayload }
  | { readonly kind: 'call_script'; readonly payload: ScriptActionPayload }
  | { readonly kind: 'send_notification'; readonly payload: NotificationActionPayload }
  | {
      readonly kind: 'custom';
      readonly customType: string;
      readonly payload: Record<string, unknown>;
    };

export interface ActionStep {
  readonly type: 'action';
  readonly action: ScriptAction;
  readonly timeoutMs?: number;
  readonly continueOnError?: boolean;
  readonly description?: string;
}

export interface ConditionStep {
  readonly type: 'condition';
  readonly condition: AutomationCondition;
  readonly description?: string;
}

export interface DelayStep {
  readonly type: 'delay';
  readonly durationMs: number;
  readonly description?: string;
}

export interface SequenceStep {
  readonly type: 'sequence';
  readonly steps: readonly ScriptStep[];
  readonly description?: string;
}

export interface ParallelStep {
  readonly type: 'parallel';
  readonly steps: readonly ScriptStep[];
  readonly maxConcurrency?: number;
  readonly description?: string;
}

export interface RepeatStep {
  readonly type: 'repeat';
  readonly count?: number;
  readonly whileCondition?: AutomationCondition;
  readonly steps: readonly ScriptStep[];
  readonly description?: string;
}

export interface ChooseBranch {
  readonly conditions: readonly AutomationCondition[];
  readonly steps: readonly ScriptStep[];
}

export interface ChooseStep {
  readonly type: 'choose';
  readonly branches: readonly ChooseBranch[];
  readonly defaultSteps?: readonly ScriptStep[];
  readonly description?: string;
}

export type ScriptStep =
  ActionStep | ConditionStep | DelayStep | SequenceStep | ParallelStep | RepeatStep | ChooseStep;

export interface HausScript {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly icon?: string;
  readonly mode?: ExecutionMode;
  readonly maxRuns?: number;
  readonly steps: readonly ScriptStep[];
  readonly metadata?: Record<string, unknown>;
}

// --- Automation Rules & Triggers ---

export interface StateTrigger {
  readonly type: 'state';
  readonly endpointId: string;
  readonly property?: string;
  readonly from?: unknown;
  readonly to?: unknown;
  readonly forDurationSeconds?: number;
}

export interface EventTrigger {
  readonly type: 'event';
  readonly eventType: string;
  readonly endpointId?: string;
  readonly data?: Record<string, unknown>;
}

export interface TimeTrigger {
  readonly type: 'time';
  readonly at?: string;
  readonly cron?: string;
  readonly sun?: 'sunrise' | 'sunset';
  readonly offsetMinutes?: number;
}

export interface NumericStateTrigger {
  readonly type: 'numeric_state';
  readonly endpointId: string;
  readonly property: string;
  readonly above?: number;
  readonly below?: number;
  readonly forDurationSeconds?: number;
}

export type AutomationTrigger = StateTrigger | EventTrigger | TimeTrigger | NumericStateTrigger;

export interface StateCondition {
  readonly type: 'state';
  readonly endpointId: string;
  readonly property: string;
  readonly operator: ConditionOperator;
  readonly value: unknown;
}

export interface TimeCondition {
  readonly type: 'time';
  readonly after?: string;
  readonly before?: string;
  readonly weekdays?: readonly number[];
}

export interface LogicalCondition {
  readonly type: 'and' | 'or' | 'not';
  readonly conditions: readonly AutomationCondition[];
}

export type AutomationCondition = StateCondition | TimeCondition | LogicalCondition;

export interface HausAutomationRule {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly enabled: boolean;
  readonly mode?: ExecutionMode;
  readonly maxRuns?: number;
  readonly triggers: readonly AutomationTrigger[];
  readonly conditions?: readonly AutomationCondition[];
  readonly actions: readonly ScriptStep[];
  readonly metadata?: Record<string, unknown>;
}

// --- Execution & History ---

export interface StepExecutionResult {
  readonly stepIndex: number;
  readonly stepType: StepType;
  readonly status: StepStatus;
  readonly durationMs: number;
  readonly error?: string;
}

export interface ExecutionHistoryRecord {
  readonly executionId: string;
  readonly sourceId: string;
  readonly sourceKind: 'scene' | 'script' | 'automation';
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly status: ExecutionStatus;
  readonly triggeredBy?: AutomationTrigger;
  readonly stepResults: readonly StepExecutionResult[];
  readonly error?: string;
}
