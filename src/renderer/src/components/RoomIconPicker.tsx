import { useEffect, useRef, useState } from 'react';
import { roomIconFor, roomIconOptions } from './Icon';

export function RoomIconPicker({
  name,
  value,
  onChange,
}: {
  name: string;
  value?: string;
  onChange: (icon: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const Icon = roomIconFor(name, value);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <div className="room-icon-picker" ref={root}>
      <button
        type="button"
        className="room-icon-picker-trigger device-group-icon"
        aria-label={`Change ${name} icon`}
        aria-expanded={open}
        title={`Change ${name} icon`}
        onClick={() => setOpen((current) => !current)}
      >
        <Icon size={18} strokeWidth={1.7} />
      </button>
      {open && (
        <div className="room-icon-picker-menu" role="menu" aria-label={`${name} room icons`}>
          {roomIconOptions.map(({ id, label, icon: OptionIcon }) => (
            <button
              type="button"
              key={id}
              role="menuitemradio"
              aria-checked={value === id || (!value && roomIconFor(name) === OptionIcon)}
              aria-label={label}
              title={label}
              onClick={() => {
                onChange(id);
                setOpen(false);
              }}
            >
              <OptionIcon size={18} strokeWidth={1.7} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
