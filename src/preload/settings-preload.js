'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settingsApi', {
  get: () => ipcRenderer.invoke('settings:get'),
  save: (config) => ipcRenderer.invoke('settings:save', config),
  test: (proxy, url) => ipcRenderer.invoke('settings:test', proxy, url),
  close: () => ipcRenderer.send('settings:close'),
  openDataDir: () => ipcRenderer.send('app:open-data-dir'),
});
