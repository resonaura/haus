import { useId, useState } from 'react';
import type { HassEntity } from '../../model';
export function EntityPicker({
  entities,
  value,
  onChange,
  label = 'Accessory',
}: {
  entities: HassEntity[];
  value: string;
  onChange: (id: string) => void;
  label?: string;
}) {
  const id = useId();
  const [query, setQuery] = useState('');
  const matches = entities.filter((item) =>
    `${item.attributes.friendly_name} ${item.entity_id}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <label className="management-field">
      <span>{label}</span>
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Find an accessory…"
        aria-label={`Find ${label.toLowerCase()}`}
      />
      <select
        aria-label={label}
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Choose an accessory</option>
        {(matches.some((item) => item.entity_id === value)
          ? matches
          : [...entities.filter((item) => item.entity_id === value), ...matches]
        ).map((item) => (
          <option key={item.entity_id} value={item.entity_id}>
            {String(item.attributes.friendly_name ?? item.entity_id)}
          </option>
        ))}
      </select>
    </label>
  );
}
