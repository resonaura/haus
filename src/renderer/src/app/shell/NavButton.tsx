import type { ReactNode } from 'react';

export function NavButton({
  children,
  icon,
  active,
  onClick,
}: {
  children: ReactNode;
  icon: ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`nav-button ${active ? 'active' : ''}`}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}
