import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './theme.css';
import './design.css';
import './materials.css';
import './home-overview.css';
import './room-devices.css';
import './device-material.css';
import './motion.css';
import './recordings.css';

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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
