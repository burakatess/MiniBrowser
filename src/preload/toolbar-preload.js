'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => {
  const listener = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('mini', {
  go: (input) => ipcRenderer.send('nav:go', String(input)),
  back: () => ipcRenderer.send('nav:back'),
  forward: () => ipcRenderer.send('nav:forward'),
  reload: () => ipcRenderer.send('nav:reload'),
  stop: () => ipcRenderer.send('nav:stop'),
  home: () => ipcRenderer.send('nav:home'),
  openSettings: () => ipcRenderer.send('settings:open'),
  newTab: () => ipcRenderer.send('tab:new'),
  selectTab: (id) => ipcRenderer.send('tab:select', Number(id)),
  closeTab: (id) => ipcRenderer.send('tab:close', Number(id)),
  toggleTunnel: () => ipcRenderer.send('tunnel:toggle'),
  onState: on('nav:state'),
  onTabs: on('tabs:state'),
  onError: on('nav:error'),
  onProxyStatus: on('proxy:status'),
  onTunnelStatus: on('tunnel:status'),
  onFocusAddress: on('ui:focus-address'),
});
