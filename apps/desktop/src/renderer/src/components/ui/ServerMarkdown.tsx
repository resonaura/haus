/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { ServerMarkdown as Markdown } from '@haus/ui/components';

export function ServerMarkdown({ text }: { text: string }) {
  return (
    <Markdown
      text={text}
      canOpenLink={(url) => /^https:\/\/(?:www\.)?(?:home-assistant\.io|github\.com)\//.test(url)}
      onOpenLink={(url) => {
        void window.hausNative?.openExternal(url).catch(() => {});
      }}
    />
  );
}
