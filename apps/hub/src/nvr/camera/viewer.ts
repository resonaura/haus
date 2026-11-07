/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
export function viewerSessionId(viewer?: { session: string | { id: string } }): string | undefined {
  return typeof viewer?.session === 'string' ? viewer.session : viewer?.session.id;
}
