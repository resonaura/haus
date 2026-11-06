/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

/**
 * Rich 16-state internal security system state machine defined in the Haus architecture blueprint.
 * Preserves custom and intermediate states without premature collapsing into Apple HomeKit's 4 targets.
 */
export type SecuritySystemInternalState =
  | 'DISARMED'
  | 'ARMING_HOME'
  | 'ARMING_AWAY'
  | 'ARMING_NIGHT'
  | 'ARMING_VACATION'
  | 'ARMING_CUSTOM'
  | 'ARMED_HOME'
  | 'ARMED_AWAY'
  | 'ARMED_NIGHT'
  | 'ARMED_VACATION'
  | 'ARMED_CUSTOM'
  | 'PENDING'
  | 'DISARMING'
  | 'TRIGGERED'
  | 'FAULT'
  | 'UNAVAILABLE';

/**
 * Canonical Apple HomeKit SecuritySystemCurrentState values.
 */
export const HapSecurityCurrentState = {
  STAY_ARM: 0,
  AWAY_ARM: 1,
  NIGHT_ARM: 2,
  DISARMED: 3,
  ALARM_TRIGGERED: 4,
} as const;
export type HapSecurityCurrentState =
  (typeof HapSecurityCurrentState)[keyof typeof HapSecurityCurrentState];

/**
 * Canonical Apple HomeKit SecuritySystemTargetState values.
 */
export const HapSecurityTargetState = {
  STAY_ARM: 0,
  AWAY_ARM: 1,
  NIGHT_ARM: 2,
  DISARM: 3,
} as const;
export type HapSecurityTargetState =
  (typeof HapSecurityTargetState)[keyof typeof HapSecurityTargetState];

export interface SecuritySystemHapMappingOptions {
  /** Configurable mapping for ARMED_VACATION (defaults to AWAY_ARM) */
  readonly vacationTarget?: HapSecurityTargetState;
  /** Configurable mapping for ARMED_CUSTOM (defaults to STAY_ARM) */
  readonly customTarget?: HapSecurityTargetState;
  /** Prior stable armed state used during ARMING_* and PENDING transitions */
  readonly priorArmedState?: HapSecurityCurrentState;
}

export interface HapSecurityProjection {
  readonly currentState: HapSecurityCurrentState;
  readonly targetState?: HapSecurityTargetState;
  readonly statusFault?: boolean;
}

/**
 * Deterministic policy table mapping Haus security state machine to Apple HomeKit.
 *
 * Invariants from deep-research-report.md:
 * 1. Never map TRIGGERED to an arm target.
 * 2. Never convert pending, arming, or disarming into ALARM_TRIGGERED.
 * 3. Vacation and custom modes require explicit configured projection.
 */
export function mapSecurityStateToHap(
  state: SecuritySystemInternalState,
  options: SecuritySystemHapMappingOptions = {},
): HapSecurityProjection {
  const vacationTarget = options.vacationTarget ?? HapSecurityTargetState.AWAY_ARM;
  const customTarget = options.customTarget ?? HapSecurityTargetState.STAY_ARM;
  const prior = options.priorArmedState ?? HapSecurityCurrentState.DISARMED;

  switch (state) {
    case 'DISARMED':
      return {
        currentState: HapSecurityCurrentState.DISARMED,
        targetState: HapSecurityTargetState.DISARM,
      };

    case 'ARMED_HOME':
      return {
        currentState: HapSecurityCurrentState.STAY_ARM,
        targetState: HapSecurityTargetState.STAY_ARM,
      };

    case 'ARMED_AWAY':
      return {
        currentState: HapSecurityCurrentState.AWAY_ARM,
        targetState: HapSecurityTargetState.AWAY_ARM,
      };

    case 'ARMED_NIGHT':
      return {
        currentState: HapSecurityCurrentState.NIGHT_ARM,
        targetState: HapSecurityTargetState.NIGHT_ARM,
      };

    case 'TRIGGERED':
      // Invariant: Never map TRIGGERED to a target state!
      return {
        currentState: HapSecurityCurrentState.ALARM_TRIGGERED,
      };

    case 'ARMING_HOME':
      return {
        currentState: prior,
        targetState: HapSecurityTargetState.STAY_ARM,
      };

    case 'ARMING_AWAY':
      return {
        currentState: prior,
        targetState: HapSecurityTargetState.AWAY_ARM,
      };

    case 'ARMING_NIGHT':
      return {
        currentState: prior,
        targetState: HapSecurityTargetState.NIGHT_ARM,
      };

    case 'ARMING_VACATION':
      return {
        currentState: prior,
        targetState: vacationTarget,
      };

    case 'ARMING_CUSTOM':
      return {
        currentState: prior,
        targetState: customTarget,
      };

    case 'DISARMING':
      return {
        currentState: prior,
        targetState: HapSecurityTargetState.DISARM,
      };

    case 'PENDING':
      // Invariant: Never convert pending into ALARM_TRIGGERED
      return {
        currentState: prior,
      };

    case 'ARMED_VACATION':
      return {
        currentState:
          vacationTarget === HapSecurityTargetState.STAY_ARM
            ? HapSecurityCurrentState.STAY_ARM
            : vacationTarget === HapSecurityTargetState.NIGHT_ARM
              ? HapSecurityCurrentState.NIGHT_ARM
              : HapSecurityCurrentState.AWAY_ARM,
        targetState: vacationTarget,
      };

    case 'ARMED_CUSTOM':
      return {
        currentState:
          customTarget === HapSecurityTargetState.AWAY_ARM
            ? HapSecurityCurrentState.AWAY_ARM
            : customTarget === HapSecurityTargetState.NIGHT_ARM
              ? HapSecurityCurrentState.NIGHT_ARM
              : HapSecurityCurrentState.STAY_ARM,
        targetState: customTarget,
      };

    case 'FAULT':
      return {
        currentState: prior,
        statusFault: true,
      };

    case 'UNAVAILABLE':
      return {
        currentState: prior,
        statusFault: true,
      };
  }
}
