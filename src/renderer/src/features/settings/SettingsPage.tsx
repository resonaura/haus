import { version as appVersion } from '../../../../../package.json';
import { Button, Switch } from '@heroui/react';
import {
  House,
  ArrowRight,
  LayoutGrid,
  ChevronRight,
  Cable,
  Box,
  ExternalLink,
} from 'lucide-react';
import type { HausController } from '../../hooks/useHaus';
import type { Route } from '../../app/navigation';
import { titleCase } from '../../model/presentation';

type Props = Pick<
  HausController,
  'mode' | 'snapshot' | 'status' | 'preferences' | 'session' | 'savePreferences' | 'preferenceSync'
> & {
  onConnect: () => void;
  onDisconnect: () => Promise<void>;
  go: (route: Route) => void;
  onPreviewDashboard: () => void;
  createDashboard: () => Promise<void>;
  dashboardBusy: boolean;
  dashboardUrl: string;
};
export function SettingsPage({
  mode,
  snapshot,
  status,
  preferences,
  preferenceSync,
  session,
  savePreferences,
  onConnect,
  onDisconnect,
  go,
  onPreviewDashboard,
  createDashboard,
  dashboardBusy,
  dashboardUrl,
}: Props) {
  return (
    <div className="settings-layout">
      <div className="settings-card">
        <div className="settings-card-title">
          <span className="settings-icon">
            <House size={24} />
          </span>
          <div>
            <h2>Your home, connected.</h2>
            <p>Home Assistant keeps everything in sync.</p>
          </div>
        </div>
        <div className="settings-row">
          <span>Home</span>
          <strong>
            {mode === 'demo'
              ? `${snapshot.config.location_name} · Demo`
              : snapshot.config.location_name}
          </strong>
        </div>
        <div className="settings-row">
          <span>Connection</span>
          <strong className="connection-value">
            <i />
            {mode === 'demo' ? 'Exploring demo' : titleCase(status)}
          </strong>
        </div>
        {session && (
          <div className="settings-row">
            <span>Address</span>
            <strong>{session.url}</strong>
          </div>
        )}
        <div className="settings-row">
          <span>Home Assistant</span>
          <strong>{snapshot.config.version ?? 'Demo'}</strong>
        </div>
        <div className="settings-card-actions">
          <Button onPress={() => onConnect()}>
            {mode === 'demo' ? 'Connect Home Assistant' : 'Manage connection'}
            <ArrowRight size={16} />
          </Button>
          {mode === 'live' && (
            <Button variant="ghost" onPress={() => void onDisconnect()}>
              Disconnect
            </Button>
          )}
        </div>
      </div>
      <div className="settings-card">
        <h2>A space that feels like you.</h2>
        <p>Make a few little adjustments.</p>
        <div className="settings-row">
          <span>Appearance</span>
          <div className="segmented">
            <button
              className={preferences.theme === 'system' ? 'selected' : ''}
              onClick={() => savePreferences({ theme: 'system' })}
            >
              System
            </button>
            <button
              className={preferences.theme === 'light' ? 'selected' : ''}
              onClick={() => savePreferences({ theme: 'light' })}
            >
              Light
            </button>
            <button
              className={preferences.theme === 'dark' ? 'selected' : ''}
              onClick={() => savePreferences({ theme: 'dark' })}
            >
              Dark
            </button>
          </div>
        </div>
        <div className="settings-row">
          <span>Group numbered lights</span>
          <Switch
            aria-label="Group numbered lights"
            isSelected={preferences.autoGroupLights !== false}
            onChange={(autoGroupLights) => savePreferences({ autoGroupLights })}
          >
            <Switch.Content>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
            </Switch.Content>
          </Switch>
        </div>
        <p className="settings-note">
          Combine matching numbered lights in the same room. Each group can also be shown
          separately.
        </p>
        {!!preferences.disabledLightGroups?.length && (
          <Button variant="ghost" onPress={() => savePreferences({ disabledLightGroups: [] })}>
            Reset separated light groups
          </Button>
        )}
        <div className="settings-row">
          <span>Favorites</span>
          <strong>
            {preferences.favorites.length}{' '}
            {preferences.favorites.length === 1 ? 'accessory' : 'accessories'}
          </strong>
        </div>
        <div className="settings-row">
          <span>Shared home layout</span>
          <span>
            {mode === 'demo'
              ? 'Local demo'
              : preferenceSync === 'synced'
                ? 'Saved on your helper'
                : preferenceSync === 'syncing'
                  ? 'Synchronizing…'
                  : preferenceSync === 'offline'
                    ? 'Saved locally · helper sync will retry'
                    : 'Local cache'}
          </span>
        </div>
        <div className="settings-row">
          <span>Notifications</span>
          <span>Low batteries, leaks & offline devices</span>
        </div>
      </div>
      <div className="settings-card">
        <h2>Connections & services.</h2>
        <p>Everything that connects and powers your home.</p>
        <button className="settings-destination" onClick={() => go({ kind: 'rooms' })}>
          <House size={19} />
          <span>
            Rooms<small>Organize spaces, names and room icons</small>
          </span>
          <ChevronRight size={17} />
        </button>
        <button className="settings-destination" onClick={() => go({ kind: 'devices' })}>
          <LayoutGrid size={19} />
          <span>
            Device catalog<small>Every registered device, including diagnostics</small>
          </span>
          <ChevronRight size={17} />
        </button>
        <button className="settings-destination" onClick={() => go({ kind: 'integrations' })}>
          <Cable size={19} />
          <span>
            Integrations<small>Connections, configuration and status</small>
          </span>
          <ChevronRight size={17} />
        </button>
        <button className="settings-destination" onClick={() => go({ kind: 'addons' })}>
          <Box size={19} />
          <span>
            Add-ons<small>Server services and available updates</small>
          </span>
          <ChevronRight size={17} />
        </button>
      </div>
      <button
        className="settings-destination settings-card"
        onClick={() => go({ kind: 'servers' })}
      >
        <Box size={22} />
        <span>
          Servers & backups
          <small>Home Assistant, connected machines and recovery copies</small>
        </span>
        <ChevronRight size={17} />
      </button>
      <div className="settings-card dashboard-card">
        <span className="settings-icon">
          <LayoutGrid size={24} />
        </span>
        <h2>A little Haus in Home Assistant.</h2>
        <p>
          Bring your rooms and accessories into a separate Home Assistant dashboard. Preview and
          export its built-in card configuration, or create it on your server.
        </p>
        <div className="dashboard-actions">
          <Button variant="outline" onPress={() => onPreviewDashboard()}>
            Preview dashboard
            <ArrowRight size={16} />
          </Button>
          {mode === 'live' && snapshot.user.is_admin && (
            <Button
              onPress={() => void createDashboard()}
              isPending={dashboardBusy}
              isDisabled={dashboardBusy}
            >
              {dashboardBusy ? 'Preparing dashboard…' : 'Create in Home Assistant'}
            </Button>
          )}
          {mode === 'live' && !snapshot.user.is_admin && (
            <span className="dashboard-admin-note">
              An administrator account is required to create a dashboard.
            </span>
          )}
          {dashboardUrl && (
            <Button
              variant="ghost"
              onPress={() => void window.hausNative?.openExternal(dashboardUrl)}
            >
              Open Haus dashboard <ExternalLink size={15} />
            </Button>
          )}
        </div>
      </div>
      <div className="settings-about">
        <span>Version {appVersion} · Thoughtfully connected.</span>
      </div>
    </div>
  );
}
