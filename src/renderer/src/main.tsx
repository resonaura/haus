import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app/App';
import { WindowControls } from './app/shell/WindowControls';
import { AppErrorBoundary, RendererReady } from './app/AppErrorBoundary';
import { failureReport } from '../../shared/recovery';
import { installHaptics } from './components/ui/haptics';
import './styles/vendor.css';
import './styles/index.scss';

const isElectron = Boolean(window.hausNative);
const platform = navigator.platform.toLowerCase();
const isMac = platform.includes('mac');
const isWindows = platform.includes('win');
const isLinux = platform.includes('linux');
document.documentElement.classList.toggle('native-electron', isElectron);
document.documentElement.classList.toggle('native-mac', isElectron && isMac);
document.documentElement.classList.toggle('native-windows', isElectron && isWindows);
document.documentElement.classList.toggle('native-linux', isElectron && isLinux);
document.documentElement.classList.toggle('native-other', isElectron && !isMac);

const stopHaptics = installHaptics();
if (import.meta.hot) import.meta.hot.dispose(stopHaptics);

window.addEventListener('error', (event) => {
  if (event.error)
    void window.hausNative?.reportFailure?.(failureReport('render', event.error)).catch(() => {});
});
ReactDOM.createRoot(document.getElementById('root')!, {
  onUncaughtError: (error) => {
    void window.hausNative?.reportFailure?.(failureReport('render', error)).catch(() => {});
  },
}).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
      <WindowControls />
      <RendererReady />
    </AppErrorBoundary>
  </React.StrictMode>,
);
