/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Text } from '@haus/ui';

export type Confirmation = {
  title: string;
  description: string;
  label: string;
  danger?: boolean;
  action: () => Promise<unknown>;
};
export type Repository = { slug: string; name: string; url: string; source?: string };
export function ManagementFeedback({ error, notice }: { error: string; notice: string }) {
  return (
    <>
      {error && (
        <Text semantic="p" role="alert" className="form-error">
          {error}
        </Text>
      )}
      {notice && (
        <Text semantic="p" role="status" className="management-notice">
          {notice}
        </Text>
      )}
    </>
  );
}
