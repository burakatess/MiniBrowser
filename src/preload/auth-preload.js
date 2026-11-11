'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('authApi', {
  info: () => ipcRenderer.invoke('auth:info'),
  submit: (username, password) => ipcRenderer.send('auth:submit', { username: String(username), password: String(password) }),
  cancel: () => ipcRenderer.send('auth:submit', null),
});
