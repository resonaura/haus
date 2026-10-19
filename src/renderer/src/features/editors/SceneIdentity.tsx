import { useState } from 'react';
import { SceneIcon } from '../../components/icons/Icon';
const choices = [
  ['mdi:sparkles', 'Custom'],
  ['mdi:weather-night', 'Night'],
  ['mdi:white-balance-sunny', 'Bright'],
  ['mdi:sofa', 'Relax'],
  ['mdi:movie-open', 'Movie'],
  ['mdi:book-open-variant', 'Read'],
  ['mdi:home', 'Home'],
];
export function SceneIdentity({
  name,
  icon,
  onChange,
}: {
  name: string;
  icon?: string;
  onChange: (patch: { name?: string; icon?: string }) => void;
}) {
  const [choosing, setChoosing] = useState(false);
  return (
    <div className="scene-identity">
      <div className="scene-name-row">
        <button
          type="button"
          className="scene-identity-icon"
          aria-label="Choose scene icon"
          aria-expanded={choosing}
          onClick={() => setChoosing(!choosing)}
        >
          <SceneIcon name={name} icon={icon} />
        </button>
        <label>
          <span>Scene name</span>
          <input
            required
            placeholder="A good evening"
            value={name}
            onChange={(event) => onChange({ name: event.target.value })}
          />
        </label>
      </div>
      {choosing && (
        <div className="scene-icon-options" aria-label="Scene icons">
          {choices.map(([value, label]) => (
            <button
              type="button"
              key={value}
              aria-pressed={icon === value}
              aria-label={label}
              onClick={() => {
                onChange({ icon: value });
                setChoosing(false);
              }}
            >
              <SceneIcon name={label} icon={value} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
