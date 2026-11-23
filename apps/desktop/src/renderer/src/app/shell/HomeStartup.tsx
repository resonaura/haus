/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Box, HausButton, Heading, Text } from '@haus/ui';
import { RefreshCw } from 'lucide-react';
import { triggerDemoMode } from '../../hooks/demo-override';

export function HomeStartup({
  failed,
  errorMessage,
  onRetry,
  onConnect,
}: {
  failed: boolean;
  errorMessage?: string;
  onRetry: () => void;
  onConnect: () => void;
}) {
  return (
    <Box
      semantic="section"
      className="home-startup"
      role="status"
      ariaLive="polite"
      ariaBusy={!failed}
    >
      <Heading level={1}>
        {failed ? 'Your home is taking a little longer' : 'Opening your home'}
      </Heading>
      <Text semantic="p">
        {failed
          ? (errorMessage ?? 'Check your connection and try again.')
          : 'Getting your rooms and devices ready.'}
      </Text>
      {failed ? (
        <Box className="home-startup__actions">
          <HausButton variant="secondary" onPress={onRetry}>
            <RefreshCw size={16} /> Try again
          </HausButton>
          <HausButton variant="secondary" onPress={() => triggerDemoMode(true)}>
            Open demo mode
          </HausButton>
          <HausButton variant="ghost" onPress={onConnect}>
            Manage connection
          </HausButton>
        </Box>
      ) : (
        <Box className="home-startup__actions">
          <Text className="home-startup__progress" ariaHidden />
          <HausButton variant="ghost" size="sm" onPress={() => triggerDemoMode(true)}>
            Open demo mode
          </HausButton>
        </Box>
      )}
    </Box>
  );
}
