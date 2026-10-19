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
  return (
    <section className="editor-blocks">
      <div className="editor-section-heading">
        <h3>{kind === 'triggers' ? 'When' : kind === 'conditions' ? 'Only if' : 'Then'}</h3>
        <button type="button" onClick={add}>
          ＋ Add {kind === 'triggers' ? 'trigger' : kind === 'conditions' ? 'condition' : 'action'}
        </button>
      </div>
      {blocks.map((block, index) => {
        const type = block.trigger ?? block.platform ?? block.condition;
        const service = String(block.action ?? block.service ?? '');
        const [domain, action] = service.split('.');
        const fields = snapshot.services[domain]?.[action]?.fields ?? {};
        return (
          <fieldset key={index}>
            <legend>{index + 1}</legend>
            <div className="editor-block-actions">
              <button
                type="button"
                aria-label={`Move ${kind} ${index + 1} up`}
                disabled={!index}
                onClick={() => {
                  const next = [...blocks];
                  [next[index - 1], next[index]] = [next[index], next[index - 1]];
                  onChange(next);
                }}
              >
                ↑
              </button>
              <button
                type="button"
                aria-label={`Remove ${kind} ${index + 1}`}
                onClick={() => onChange(blocks.filter((_, at) => at !== index))}
              >
                Remove
              </button>
            </div>
            {kind !== 'actions' && (
              <label className="management-field">
                <span>{kind === 'triggers' ? 'Trigger' : 'Condition'}</span>
                <select
                  value={type ?? 'advanced'}
                  onChange={(event) =>
                    patch(
                      index,
                      kind === 'triggers'
                        ? {
                            trigger: event.target.value,
                            ...(event.target.value === 'time'
                              ? { at: '08:00:00' }
                              : event.target.value === 'sun'
                                ? { event: 'sunset' }
                                : { entity_id: '', to: 'on' }),
                          }
                        : { condition: event.target.value, entity_id: '', state: 'on' },
                    )
                  }
                >
                  {(kind === 'triggers'
                    ? ['state', 'numeric_state', 'time', 'sun']
                    : ['state', 'numeric_state']
                  ).map((value) => (
                    <option key={value} value={value}>
                      {value.replaceAll('_', ' ')}
                    </option>
                  ))}
                  {!['state', 'numeric_state', 'time', 'sun'].includes(type) && (
                    <option value={type ?? 'advanced'}>Advanced configuration</option>
                  )}
                </select>
              </label>
            )}
            {kind === 'actions' ? (
              <>
                <label className="management-field">
                  <span>Action</span>
                  <select
                    value={service}
                    onChange={(event) =>
                      patch(index, { ...block, action: event.target.value, service: undefined })
                    }
                  >
                    {Object.entries(snapshot.services).flatMap(([domain, services]) =>
                      Object.entries(services).map(([name, info]) => (
                        <option key={`${domain}.${name}`} value={`${domain}.${name}`}>
                          {String(
                            `${domain.replaceAll('_', ' ')} · ${info.name ?? name.replaceAll('_', ' ')}`,
                          )}
                        </option>
                      )),
                    )}
                  </select>
                </label>
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
              <label className="management-field">
                <span>Time</span>
                <input
                  type="time"
                  value={typeof block.at === 'string' ? block.at : ''}
                  onChange={(event) => patch(index, { ...block, at: event.target.value })}
                />
              </label>
            ) : type === 'sun' ? (
              <label className="management-field">
                <span>Sun</span>
                <select
                  value={block.event}
                  onChange={(event) => patch(index, { ...block, event: event.target.value })}
                >
                  <option value="sunrise">Sunrise</option>
                  <option value="sunset">Sunset</option>
                </select>
              </label>
            ) : ['state', 'numeric_state'].includes(type) ? (
              <>
                <EntityPicker
                  entities={snapshot.states}
                  value={typeof block.entity_id === 'string' ? block.entity_id : ''}
                  onChange={(entity_id) => patch(index, { ...block, entity_id })}
                />
                {type === 'state' ? (
                  <label className="management-field">
                    <span>{kind === 'triggers' ? 'Becomes' : 'Is'}</span>
                    <input
                      value={String(block.to ?? block.state ?? '')}
                      onChange={(event) =>
                        patch(index, {
                          ...block,
                          [kind === 'triggers' ? 'to' : 'state']: event.target.value,
                        })
                      }
                    />
                  </label>
                ) : (
                  <div className="editor-two-columns">
                    {['above', 'below'].map((key) => (
                      <label className="management-field" key={key}>
                        <span>{key}</span>
                        <input
                          type="number"
                          value={block[key] ?? ''}
                          onChange={(event) =>
                            patch(index, {
                              ...block,
                              [key]:
                                event.target.value === '' ? undefined : Number(event.target.value),
                            })
                          }
                        />
                      </label>
                    ))}
                  </div>
                )}
              </>
            ) : null}
            <details>
              <summary>Advanced options</summary>
              <JsonField
                label="Configuration"
                value={block}
                onChange={(value) => patch(index, value as Block)}
              />
            </details>
          </fieldset>
        );
      })}
    </section>
  );
}
