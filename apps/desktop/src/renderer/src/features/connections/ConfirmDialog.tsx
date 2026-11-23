/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { HausButton, HausDialog, Text } from '@haus/ui';
import type { Confirmation } from './ManagementFeedback';

export function ConfirmDialog({
  confirmation,
  busy,
  onClose,
  onConfirm,
}: {
  confirmation: Confirmation;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <HausDialog
      title={confirmation.title}
      backdrop="blur"
      scrollable={false}
      onClose={onClose}
      footer={
        <>
          <HausButton variant="ghost" onPress={onClose}>
            Cancel
          </HausButton>
          <HausButton
            variant={confirmation.danger ? 'danger' : 'primary'}
            isDisabled={busy}
            onPress={onConfirm}
          >
            {confirmation.label}
          </HausButton>
        </>
      }
    >
      <Text className="flow-description" tone="secondary" size={13}>
        {confirmation.description}
      </Text>
    </HausDialog>
  );
}
