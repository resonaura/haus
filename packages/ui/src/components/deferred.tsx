/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Suspense, type ReactNode } from 'react';
import { Box, Text } from '../primitives/index.js';

export function FeatureLoading({ overlay = false }: { overlay?: boolean }) {
  return (
    <Box
      className={`feature-loading${overlay ? ' is-overlay' : ''}`}
      role="status"
      ariaLive="polite"
    >
      <Text>Loading…</Text>
    </Box>
  );
}
export function Deferred({
  children,
  overlay = false,
}: {
  children: ReactNode;
  overlay?: boolean;
}) {
  return <Suspense fallback={<FeatureLoading overlay={overlay} />}>{children}</Suspense>;
}
