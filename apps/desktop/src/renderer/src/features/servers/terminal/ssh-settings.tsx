/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { SshSettingsForm as SharedSshSettingsForm } from '@haus/ui/components';
import type { ServerSshInput } from '../../../../../shared/terminal';

export interface SshSettingsFormProps {
  readonly profile: ServerSshInput;
  readonly configured: boolean;
  readonly showWslEnvironment: boolean;
  readonly loaded: boolean;
  readonly connecting: boolean;
  readonly onChange: (patch: Partial<ServerSshInput>) => void;
  readonly onSubmit: () => void;
}

export function SshSettingsForm({
  profile,
  configured,
  showWslEnvironment,
  loaded,
  connecting,
  onChange,
  onSubmit,
}: SshSettingsFormProps) {
  return (
    <SharedSshSettingsForm
      profile={profile}
      configured={configured}
      showWslEnvironment={showWslEnvironment}
      loaded={loaded}
      connecting={connecting}
      onChange={onChange}
      onSubmit={onSubmit}
    />
  );
}
