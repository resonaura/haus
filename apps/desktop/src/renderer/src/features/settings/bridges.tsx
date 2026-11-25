/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { useEffect, useState } from 'react';
import { parseBridgeSuggestionsResponse, type BridgeSuggestion } from '@haus/core/transport';
import { Box, HausButton, HausDisclosure, Heading, Text } from '@haus/ui';
import { House } from 'lucide-react';

type State = { state: 'loading' | 'failed' } | { state: 'loaded'; suggestions: BridgeSuggestion[] };

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
        const suggestions = parseBridgeSuggestionsResponse(response);
        if (active) setResult({ state: 'loaded', suggestions });
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
    <Box semantic="section" className="settings-card" ariaLabelledBy="apple-home-settings">
      <Box className="settings-card-title">
        <Text className="settings-icon">
          <House size={24} />
        </Text>
        <Box>
          <Heading level={2} id="apple-home-settings">
            Apple Home
          </Heading>
          <Text semantic="p">Suggested bridges</Text>
        </Box>
      </Box>
      {result.state === 'loading' && (
        <Text semantic="p" role="status">
          Loading suggested bridges…
        </Text>
      )}
      {result.state === 'failed' && (
        <Box className="settings-row">
          <Text semantic="p" role="status">
            Couldn’t load bridge suggestions.
          </Text>
          <HausButton
            variant="outline"
            onPress={() => {
              setResult({ state: 'loading' });
              setAttempt((previous) => previous + 1);
            }}
          >
            Retry
          </HausButton>
        </Box>
      )}
      {result.state === 'loaded' &&
        (result.suggestions.length ? (
          result.suggestions.map(({ name, devices }) => (
            <HausDisclosure
              key={name}
              className="settings-note"
              summary={`${name} · ${devices.length} accessories`}
            >
              <Box semantic="list">
                {devices.map((device) => (
                  <Box semantic="listitem" key={device.id}>
                    {device.name}
                  </Box>
                ))}
              </Box>
            </HausDisclosure>
          ))
        ) : (
          <Text semantic="p">No groups of compatible devices yet.</Text>
        ))}
    </Box>
  );
}
