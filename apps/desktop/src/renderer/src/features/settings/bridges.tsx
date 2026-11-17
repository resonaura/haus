/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { useEffect, useState } from 'react';
import { Button } from '@heroui/react';
import { House } from 'lucide-react';

type Device = { id: string; name: string };
type Suggestion = { name: string; devices: Device[] };
type State = { state: 'loading' | 'failed' } | { state: 'loaded'; suggestions: Suggestion[] };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function suggestedDevice(value: unknown): value is Device {
  return record(value) && typeof value.id === 'string' && typeof value.name === 'string';
}

function suggestion(value: unknown): value is Suggestion {
  return (
    record(value) &&
    typeof value.name === 'string' &&
    Array.isArray(value.devices) &&
    value.devices.every(suggestedDevice)
  );
}

export function BridgeSuggestions() {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<State>({ state: 'loading' });

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const response = await window.hausNative?.management({
          method: 'GET',
          path: 'homekit/bridge/suggestions',
        });
        if (
          !record(response) ||
          !Array.isArray(response.suggestions) ||
          !response.suggestions.every(suggestion)
        )
          throw new Error('invalid_bridge_suggestions');
        if (active) setResult({ state: 'loaded', suggestions: response.suggestions });
      } catch {
        if (active) setResult({ state: 'failed' });
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [attempt]);

  return (
    <section className="settings-card" aria-labelledby="apple-home-settings">
      <div className="settings-card-title">
        <span className="settings-icon">
          <House size={24} />
        </span>
        <div>
          <h2 id="apple-home-settings">Apple Home</h2>
          <p>Suggested bridges</p>
        </div>
      </div>
      {result.state === 'loading' && <p role="status">Loading suggested bridges…</p>}
      {result.state === 'failed' && (
        <div className="settings-row">
          <p role="status">Couldn’t load bridge suggestions.</p>
          <Button
            variant="outline"
            onPress={() => {
              setResult({ state: 'loading' });
              setAttempt((previous) => previous + 1);
            }}
          >
            Retry
          </Button>
        </div>
      )}
      {result.state === 'loaded' &&
        (result.suggestions.length ? (
          result.suggestions.map(({ name, devices }) => (
            <details key={name} className="settings-note">
              <summary>
                {name} · {devices.length} accessories
              </summary>
              <ul>
                {devices.map((device) => (
                  <li key={device.id}>{device.name}</li>
                ))}
              </ul>
            </details>
          ))
        ) : (
          <p>No groups of compatible devices yet.</p>
        ))}
    </section>
  );
}
