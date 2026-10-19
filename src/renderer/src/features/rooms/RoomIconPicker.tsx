import { useEffect, useRef, useState } from 'react';
import { roomIconFor, roomIconOptions } from '../../components/icons/Icon';

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
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  useEffect(() => {
    if (open) root.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        trigger.current?.focus();
      }
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
        ref={trigger}
        type="button"
        className="room-icon-picker-trigger device-group-icon"
        aria-label={`Change ${name} icon`}
        aria-expanded={open}
        aria-haspopup="menu"
        title={`Change ${name} icon`}
        onClick={() => setOpen((current) => !current)}
      >
        <Icon size={18} strokeWidth={1.7} />
      </button>
      {open && (
        <div
          className="room-icon-picker-menu"
          role="menu"
          aria-label={`${name} room icons`}
          onKeyDown={(event) => {
            const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            const offset =
              event.key === 'ArrowDown'
                ? 2
                : event.key === 'ArrowUp'
                  ? -2
                  : event.key === 'ArrowRight'
                    ? 1
                    : event.key === 'ArrowLeft'
                      ? -1
                      : 0;
            if (offset || event.key === 'Home' || event.key === 'End') {
              event.preventDefault();
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? buttons.length - 1
                    : (index + offset + buttons.length) % buttons.length;
              buttons[next]?.focus();
            }
            if (event.key === 'Tab') setOpen(false);
          }}
        >
          {roomIconOptions.map(({ id, label, icon: OptionIcon }) => (
            <button
              type="button"
              key={id}
              role="menuitemradio"
              aria-checked={(value ?? 'auto') === id}
              aria-label={label}
              title={label}
              onClick={() => {
                onChange(id);
                close();
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
