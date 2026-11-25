/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

const TRANSFER_ERRORS: Record<string, string> = {
  xiaomi_ble_requires_a_miku_bluetooth_controller:
    'This rule needs a Xiaomi BLE dimmer; Miku has no Bluetooth controller yet.',
  device_action_entity_unavailable: 'A device action has no matching Home Assistant entity.',
  device_action_target_unavailable: 'A target device has no matching entity in the transfer file.',
  device_condition_target_unavailable:
    'A device condition has no matching entity in the transfer file.',
  automation_trigger_entity_unavailable: 'A trigger entity is not currently available in Haus.',
  automation_action_target_unavailable: 'An action target is not currently available in Haus.',
  automation_scene_unavailable: 'The scene used by this rule is not available in Haus.',
  automation_script_unavailable: 'A script used by this rule has not been imported.',
  unsupported_automation_action: 'Haus cannot execute one of this rule’s actions yet.',
  unsupported_automation_condition: 'Haus cannot evaluate one of this rule’s conditions yet.',
  unsupported_automation_device_trigger: 'Haus cannot represent this device trigger yet.',
  unsupported_automation_trigger: 'Haus cannot represent this trigger yet.',
  unsupported_automation_template:
    'This rule uses Home Assistant templates that Haus cannot execute yet.',
  automation_import_target_exists: 'A Haus rule already uses this ID; it was left unchanged.',
  script_import_target_exists: 'A Haus script already uses this ID; it was left unchanged.',
  automation_import_not_cut_over:
    'The Home Assistant source has not been safely disabled, so Haus kept this rule paused.',
  automation_action_required: 'Haus could not translate this rule into executable actions.',
  script_steps_required: 'Haus could not translate this script into executable steps.',
};

export function friendlyTransferError(message: string): string {
  const matchingError = Object.entries(TRANSFER_ERRORS).find(([code]) => message.includes(code));
  if (matchingError) return matchingError[1];
  const hubError = /The Hub request failed \((\d{3})(?:: ([a-z0-9_]{1,96}))?\)/.exec(message);
  if (hubError) {
    const reason = hubError[2] ? `, ${hubError[2]}` : '';
    return `Haus rejected this rule (${hubError[1]}${reason}); Home Assistant remains unchanged.`;
  }
  return 'Haus could not safely translate this rule. Home Assistant remains unchanged.';
}

export const friendlyError = friendlyTransferError;
