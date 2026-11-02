/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Button } from '@heroui/react';
import { RefreshCw } from 'lucide-react';

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
    <section className="home-startup" role="status" aria-live="polite" aria-busy={!failed}>
      <h1>{failed ? 'Your home is taking a little longer' : 'Opening your home'}</h1>
      <p>
        {failed
          ? (errorMessage ?? 'Check your connection and try again.')
          : 'Getting your rooms and devices ready.'}
      </p>
      {failed ? (
        <div className="home-startup__actions">
          <Button variant="secondary" onPress={onRetry}>
            <RefreshCw size={16} /> Try again
          </Button>
          <Button variant="ghost" onPress={onConnect}>
            Manage connection
          </Button>
        </div>
      ) : (
        <span className="home-startup__progress" aria-hidden="true" />
      )}
    </section>
  );
}
