import { House, ChevronRight, Menu, Search, Command, Bell } from 'lucide-react';
import type { Route } from '../navigation';
type Props = {
  route: Route;
  heading: string;
  homeName: string;
  mode: 'live' | 'demo';
  notificationCount: number;
  attentionCount: number;
  userName?: string;
  onOpenNavigation: () => void;
  onSearch: () => void;
  go: (route: Route) => void;
};
export function Topbar({
  route,
  heading,
  homeName,
  mode,
  notificationCount,
  attentionCount,
  userName,
  onOpenNavigation,
  onSearch,
  go,
}: Props) {
  return (
    <header className="topbar">
      <div className="breadcrumb">
        <button
          className="mobile-menu icon-button"
          aria-label="Open navigation"
          onClick={() => onOpenNavigation()}
        >
          <Menu size={20} />
        </button>
        <House size={15} />
        <span>{homeName}</span>
        <ChevronRight size={13} />
        <strong>{route.kind === 'home' ? 'Overview' : heading}</strong>
      </div>
      <div className="topbar-actions">
        {mode === 'demo' && <span className="demo-badge">DEMO HOME</span>}
        <button className="icon-button" aria-label="Search devices" onClick={onSearch}>
          <Search size={19} />
          <span className="shortcut">
            <Command size={10} /> K
          </span>
        </button>
        <button
          className="icon-button notification-button"
          aria-label={`Notifications${notificationCount ? `, ${notificationCount}` : ''}`}
          onClick={() => go({ kind: 'attention' })}
        >
          <Bell size={19} />
          {(notificationCount > 0 || attentionCount > 0) && <i />}
        </button>
        <span className="topbar-divider" />
        <button
          className="profile-button"
          aria-label="Home settings"
          onClick={() => go({ kind: 'settings' })}
        >
          {userName?.slice(0, 1) ?? 'H'}
        </button>
      </div>
    </header>
  );
}
