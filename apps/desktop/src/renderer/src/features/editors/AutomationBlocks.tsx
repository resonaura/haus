/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Box, HausDisclosure, Heading, Pressable, SelectInput, Text, TextInput } from '@haus/ui';
import type { Snapshot } from '../../model';
import { EntityPicker } from '../../components/forms/EntityPicker';
import { JsonField, SchemaFields } from '../../components/forms/SchemaForm';
type Block = Record<string, any>;
export function AutomationBlocks({
  kind,
  blocks,
  onChange,
  snapshot,
}: {
  kind: 'triggers' | 'conditions' | 'actions';
  blocks: Block[];
  onChange: (blocks: Block[]) => void;
  snapshot: Snapshot;
}) {
  const patch = (index: number, value: Block) =>
    onChange(blocks.map((item, at) => (at === index ? value : item)));
  const add = () =>
    onChange([
      ...blocks,
      kind === 'triggers'
        ? { trigger: 'state', entity_id: '', to: 'on' }
        : kind === 'conditions'
          ? { condition: 'state', entity_id: '', state: 'on' }
          : { action: 'light.turn_on', target: { entity_id: '' } },
    ]);
  const serviceOptions = Object.entries(snapshot.services).flatMap(([domain, services]) =>
    Object.entries(services).map(([name, info]) => ({
      value: `${domain}.${name}`,
      label: String(`${domain.replaceAll('_', ' ')} · ${info.name ?? name.replaceAll('_', ' ')}`),
    })),
  );
  return (
    <Box semantic="section" className="editor-blocks">
      <Box className="editor-section-heading">
        <Heading level={3}>
          {kind === 'triggers' ? 'When' : kind === 'conditions' ? 'Only if' : 'Then'}
        </Heading>
        <Pressable type="button" onPress={add}>
          ＋ Add {kind === 'triggers' ? 'trigger' : kind === 'conditions' ? 'condition' : 'action'}
        </Pressable>
      </Box>
      {blocks.map((block, index) => {
        const type = block.trigger ?? block.platform ?? block.condition;
        const service = String(block.action ?? block.service ?? '');
        const [domain, action] = service.split('.');
        const fields = snapshot.services[domain]?.[action]?.fields ?? {};
        const typeOptions = [
          ...(kind === 'triggers'
            ? ['state', 'numeric_state', 'time', 'sun']
            : ['state', 'numeric_state']
          ).map((value) => ({ value, label: value.replaceAll('_', ' ') })),
          ...(!['state', 'numeric_state', 'time', 'sun'].includes(type)
            ? [{ value: String(type ?? 'advanced'), label: 'Advanced configuration' }]
            : []),
        ];
        return (
          <Box semantic="fieldset" key={index}>
            <Box semantic="legend">{index + 1}</Box>
            <Box className="editor-block-actions">
              <Pressable
                type="button"
                ariaLabel={`Move ${kind} ${index + 1} up`}
                disabled={!index}
                onPress={() => {
                  const next = [...blocks];
                  [next[index - 1], next[index]] = [next[index], next[index - 1]];
                  onChange(next);
                }}
              >
                ↑
              </Pressable>
              <Pressable
                type="button"
                ariaLabel={`Remove ${kind} ${index + 1}`}
                onPress={() => onChange(blocks.filter((_, at) => at !== index))}
              >
                Remove
              </Pressable>
            </Box>
            {kind !== 'actions' && (
              <Text semantic="label" className="management-field">
                <Text>{kind === 'triggers' ? 'Trigger' : 'Condition'}</Text>
                <SelectInput
                  value={String(type ?? 'advanced')}
                  options={typeOptions}
                  onChange={(nextType) =>
                    patch(
                      index,
                      kind === 'triggers'
                        ? {
                            trigger: nextType,
                            ...(nextType === 'time'
                              ? { at: '08:00:00' }
                              : nextType === 'sun'
                                ? { event: 'sunset' }
                                : { entity_id: '', to: 'on' }),
                          }
                        : { condition: nextType, entity_id: '', state: 'on' },
                    )
                  }
                />
              </Text>
            )}
            {kind === 'actions' ? (
              <>
                <Text semantic="label" className="management-field">
                  <Text>Action</Text>
                  <SelectInput
                    value={service}
                    options={serviceOptions}
                    onChange={(nextService) =>
                      patch(index, { ...block, action: nextService, service: undefined })
                    }
                  />
                </Text>
                <EntityPicker
                  entities={snapshot.states.filter((item) =>
                    item.entity_id.startsWith(`${domain}.`),
                  )}
                  value={typeof block.target?.entity_id === 'string' ? block.target.entity_id : ''}
                  onChange={(entity_id) =>
                    patch(index, { ...block, target: { ...block.target, entity_id } })
                  }
                />
                <SchemaFields
                  schema={Object.entries(fields)
                    .filter(([name]) => name !== 'entity_id')
                    .map(([name, value]) => ({ name, ...(value as object) }))}
                  values={block.data ?? {}}
                  onChange={(data) => patch(index, { ...block, data })}
                  snapshot={snapshot}
                />
              </>
            ) : type === 'time' ? (
              <Text semantic="label" className="management-field">
                <Text>Time</Text>
                <TextInput
                  inputType="time"
                  value={typeof block.at === 'string' ? block.at : ''}
                  onChange={(at) => patch(index, { ...block, at })}
                />
              </Text>
            ) : type === 'sun' ? (
              <Text semantic="label" className="management-field">
                <Text>Sun</Text>
                <SelectInput
                  value={String(block.event ?? 'sunset')}
                  options={[
                    { value: 'sunrise', label: 'Sunrise' },
                    { value: 'sunset', label: 'Sunset' },
                  ]}
                  onChange={(nextEvent) => patch(index, { ...block, event: nextEvent })}
                />
              </Text>
            ) : ['state', 'numeric_state'].includes(type) ? (
              <>
                <EntityPicker
                  entities={snapshot.states}
                  value={typeof block.entity_id === 'string' ? block.entity_id : ''}
                  onChange={(entity_id) => patch(index, { ...block, entity_id })}
                />
                {type === 'state' ? (
                  <Text semantic="label" className="management-field">
                    <Text>{kind === 'triggers' ? 'Becomes' : 'Is'}</Text>
                    <TextInput
                      value={String(block.to ?? block.state ?? '')}
                      onChange={(nextVal) =>
                        patch(index, {
                          ...block,
                          [kind === 'triggers' ? 'to' : 'state']: nextVal,
                        })
                      }
                    />
                  </Text>
                ) : (
                  <Box className="editor-two-columns">
                    {['above', 'below'].map((key) => (
                      <Text semantic="label" className="management-field" key={key}>
                        <Text>{key}</Text>
                        <TextInput
                          inputType="number"
                          value={block[key] !== undefined ? String(block[key]) : ''}
                          onChange={(nextVal) =>
                            patch(index, {
                              ...block,
                              [key]: nextVal === '' ? undefined : Number(nextVal),
                            })
                          }
                        />
                      </Text>
                    ))}
                  </Box>
                )}
              </>
            ) : null}
            <HausDisclosure summary="Advanced options">
              <JsonField
                label="Configuration"
                value={block}
                onChange={(value) => patch(index, value as Block)}
              />
            </HausDisclosure>
          </Box>
        );
      })}
    </Box>
  );
}
