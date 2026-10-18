import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronRight } from 'lucide-react';
import type { ContextMenuItem } from '../../../../shared/native';

type Props = {
  items: ContextMenuItem[];
  x: number;
  y: number;
  onAction: (id: string) => void;
  onClose: () => void;
};

/** Web fallback for the native menu, including nested keyboard navigation. */
export function ContextMenu({ items, x, y, onAction, onClose }: Props) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    root.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <>
      <div
        className="native-context-menu-backdrop"
        onPointerDown={onClose}
        onContextMenu={(event) => {
          event.preventDefault();
          onClose();
        }}
      />
      <div
        ref={root}
        onClick={(event) => event.stopPropagation()}
        className={`native-context-menu ${x > window.innerWidth - 420 ? 'opens-left' : ''}`}
        style={{ left: x, top: y }}
      >
        <MenuItems items={items} onAction={onAction} onClose={onClose} />
      </div>
    </>
  );
}

function MenuItems({
  items,
  onAction,
  onClose,
  onBack,
}: Pick<Props, 'items' | 'onAction' | 'onClose'> & { onBack?: () => void }) {
  const [openId, setOpenId] = useState<string>();
  const menu = useRef<HTMLDivElement>(null);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('[role="menu"]') !== event.currentTarget) return;
    const buttons = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not(:disabled)',
      ),
    ].filter((button) => button.closest('[role="menu"]') === event.currentTarget);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next: number | undefined;
    if (event.key === 'ArrowDown') next = (index + 1) % buttons.length;
    if (event.key === 'ArrowUp') next = (index - 1 + buttons.length) % buttons.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = buttons.length - 1;
    if (next !== undefined) {
      event.preventDefault();
      buttons[next]?.focus();
    }
    if (event.key === 'ArrowRight') {
      const button = buttons[index];
      if (button?.getAttribute('aria-haspopup') === 'menu') {
        event.preventDefault();
        button.click();
      }
    }
    if (event.key === 'ArrowLeft' && onBack) {
      event.preventDefault();
      event.stopPropagation();
      onBack();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
    if (event.key === 'Tab') onClose();
  };
  useEffect(() => {
    if (onBack) menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, []);
  return (
    <div role="menu" ref={menu} onKeyDown={onKeyDown}>
      {items.map((item, index) =>
        item.type === 'separator' ? (
          <div
            key={`separator-${index}`}
            role="separator"
            className="native-context-menu-separator"
          />
        ) : (
          <div
            key={item.id}
            className={item.type === 'submenu' ? 'native-context-menu-parent' : undefined}
            onMouseEnter={() =>
              setOpenId(item.type === 'submenu' && item.enabled !== false ? item.id : undefined)
            }
          >
            <button
              type="button"
              role="menuitem"
              className="native-context-menu-item"
              disabled={item.enabled === false}
              aria-haspopup={item.type === 'submenu' ? 'menu' : undefined}
              aria-expanded={item.type === 'submenu' ? openId === item.id : undefined}
              onClick={() =>
                item.type === 'submenu'
                  ? setOpenId(openId === item.id ? undefined : item.id)
                  : onAction(item.id)
              }
            >
              {item.label}
              {item.type === 'submenu' && <ChevronRight size={13} />}
            </button>
            {item.type === 'submenu' && openId === item.id && (
              <div className="native-context-menu native-context-submenu">
                <MenuItems
                  items={item.items ?? []}
                  onAction={onAction}
                  onClose={onClose}
                  onBack={() => {
                    setOpenId(undefined);
                    menu.current
                      ?.querySelector<HTMLButtonElement>('[aria-expanded="true"]')
                      ?.focus();
                  }}
                />
              </div>
            )}
          </div>
        ),
      )}
    </div>
  );
}
