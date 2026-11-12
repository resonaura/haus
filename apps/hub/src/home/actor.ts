/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { ForbiddenException } from '@nestjs/common';

/** AuthGuard supplies this session; missing roles never become a local administrator. */
export function appActor(request: object, write = false): string {
  const session: unknown = Reflect.get(request, 'user');
  if (
    !session ||
    typeof session !== 'object' ||
    !('clientId' in session) ||
    typeof session.clientId !== 'string' ||
    !session.clientId ||
    (write && (!('clientRole' in session) || session.clientRole !== 'admin'))
  )
    throw new ForbiddenException({ error: 'app_permission_denied' });
  return session.clientId;
}
