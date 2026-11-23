/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { VectorGraphic } from '@haus/ui';
import { siDocker, siPm2 } from 'simple-icons';
import { ServerIcon } from '../../components/icons/ServerIcon';
import type { ServerHost } from './types';
import type { ServiceKind } from './service-activity';

export function ServiceManagerIcon({
  kind,
  host,
  size = 22,
}: {
  kind: ServiceKind;
  host: ServerHost | null;
  size?: number;
}) {
  if (kind === 'systemServices')
    return <ServerIcon server={{ host }} size={size} className="server-service-manager-icon" />;
  const icon = kind === 'docker' ? siDocker : siPm2;
  return (
    <VectorGraphic
      className="server-service-manager-icon"
      width={size}
      height={size}
      viewWidth={24}
      viewHeight={24}
      fill="currentColor"
      ariaHidden
      focusable={false}
      paths={[{ d: icon.path }]}
    />
  );
}
