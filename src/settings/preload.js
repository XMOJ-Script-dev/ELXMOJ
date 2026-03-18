'use strict';

/**
 * Preload script for the Settings window.
 * Exposes a safe bridge to read and write persistent app settings.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settingsAPI', {
    getAll: () => ipcRenderer.invoke('settings-get-all'),
    set: (key, value) => ipcRenderer.invoke('settings-set', key, value),
    get: (key) => ipcRenderer.invoke('settings-get', key),
    getVersion: () => ipcRenderer.invoke('get-version'),
    navigate: (url) => ipcRenderer.invoke('navigate', url),
});
