/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useEffect, useState } from 'react';
import {
  readEditableConfig,
  type EditableConfig,
  type ManagementPort,
} from '@haus/core/transport';

/** Loads editable automation configurations in the background so Gallery cards render rich When -> Do summaries. */
export function useAutomationConfigs(
  management: ManagementPort | undefined,
  rules: readonly { readonly entityId: string; readonly ruleId: string }[],
  demo?: boolean,
): Readonly<Record<string, EditableConfig>> {
  const [configs, setConfigs] = useState<Record<string, EditableConfig>>({});
  const signature = rules
    .map((r) => `${r.entityId}:${r.ruleId}`)
    .join('|');

  useEffect(() => {
    if (demo || !management || rules.length === 0) return;
    let active = true;
    const targets = rules.filter((r) => /^[a-z0-9_-]{1,128}$/i.test(r.ruleId)).slice(0, 48);
    void Promise.all(
      targets.map(async (item) => {
        try {
          const loaded = await readEditableConfig(management, 'automation', item.ruleId);
          return [item.entityId, loaded] as const;
        } catch {
          return null;
        }
      }),
    ).then((entries) => {
      if (!active) return;
      const next: Record<string, EditableConfig> = {};
      for (const entry of entries) {
        if (entry) next[entry[0]] = entry[1];
      }
      setConfigs(next);
    });
    return () => {
      active = false;
    };
  }, [demo, management, signature]);

  return configs;
}
