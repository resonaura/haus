import { useId, useState } from 'react';
import { Check, ChevronDown, RotateCcw } from 'lucide-react';
import { ServerIcon } from '../../components/icons/ServerIcon';
import { resolveServerIcon, serverIconOptions, type ServerIconId } from '../../model/server-icon';
import type { HomeServer } from './types';
import './styles/icon-picker.scss';

export function ServerIconPicker({
  server,
  value,
  onChange,
  disabled = false,
}: {
  server: HomeServer;
  value?: ServerIconId;
  onChange: (icon: ServerIconId | undefined) => void;
  disabled?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const optionsId = useId();
  const labelId = useId();
  const automaticIcon = resolveServerIcon(server);
  const automaticLabel = serverIconOptions.find((option) => option.id === automaticIcon)?.label;
  const selectedLabel = value
    ? serverIconOptions.find((option) => option.id === value)?.label
    : `Automatic${automaticLabel ? ` · ${automaticLabel}` : ''}`;

  return (
    <div className="server-icon-picker">
      <span className="server-icon-picker-label" id={labelId}>
        Icon
      </span>
      <div className="server-icon-picker-heading">
        <button
          type="button"
          className="server-icon-picker-trigger"
          aria-labelledby={labelId}
          aria-expanded={expanded}
          aria-controls={optionsId}
          disabled={disabled}
          onClick={() => setExpanded((current) => !current)}
        >
          <span className="server-icon-picker-preview">
            <ServerIcon server={server} icon={value} size={27} />
          </span>
          <span className="server-icon-picker-choice">{selectedLabel}</span>
          <ChevronDown size={17} className={expanded ? 'is-expanded' : undefined} />
        </button>
        {value && (
          <button
            type="button"
            className="server-icon-picker-reset"
            disabled={disabled}
            onClick={() => onChange(undefined)}
          >
            <RotateCcw size={14} />
            <span>Use automatic</span>
          </button>
        )}
      </div>
      <div
        id={optionsId}
        className="server-icon-picker-options"
        role="group"
        aria-labelledby={labelId}
        hidden={!expanded}
      >
        <button
          type="button"
          className="server-icon-picker-option"
          aria-pressed={!value}
          disabled={disabled}
          onClick={() => onChange(undefined)}
        >
          <ServerIcon server={server} size={26} />
          <span>Automatic</span>
          {!value && <Check className="server-icon-picker-check" size={13} />}
        </button>
        {serverIconOptions.map((option) => (
          <button
            type="button"
            key={option.id}
            className="server-icon-picker-option"
            aria-pressed={value === option.id}
            disabled={disabled}
            onClick={() => onChange(option.id)}
          >
            <ServerIcon server={server} icon={option.id} size={26} />
            <span>{option.label}</span>
            {value === option.id && <Check className="server-icon-picker-check" size={13} />}
          </button>
        ))}
      </div>
      <p className="server-icon-picker-note">
        Automatic follows the server identity and operating system.
      </p>
    </div>
  );
}
