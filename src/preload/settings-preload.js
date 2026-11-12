'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settingsApi', {
  get: () => ipcRenderer.invoke('settings:get'),
  save: (config) => ipcRenderer.invoke('settings:save', config),
  test: (proxy, url) => ipcRenderer.invoke('settings:test', proxy, url),
  connectTunnel: () => ipcRenderer.invoke('tunnel:connect'),
  disconnectTunnel: () => ipcRenderer.invoke('tunnel:disconnect'),
  pickKey: () => ipcRenderer.invoke('settings:pick-key'),
  onTunnelStatus: (cb) => ipcRenderer.on('tunnel:status', (_e, s) => cb(s)),
  close: () => ipcRenderer.send('settings:close'),
  openDataDir: () => ipcRenderer.send('app:open-data-dir'),
});
