import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('securePad', {
  version: () => process.env.npm_package_version ?? 'dev',
  openFile: () => ipcRenderer.invoke('securepad:open-file'),
  saveFile: (payload) => ipcRenderer.invoke('securepad:save-file', payload),
  onAction: (callback) => {
    if (typeof callback !== 'function') {
      return undefined;
    }

    const listener = (_event, action) => {
      callback(action);
    };

    ipcRenderer.on('securepad:action', listener);

    return () => {
      ipcRenderer.removeListener('securepad:action', listener);
    };
  },
  auth: {
    hasUsers: () => ipcRenderer.invoke('securepad:auth-has-users'),
    register: (payload) => ipcRenderer.invoke('securepad:auth-register', payload),
    login: (payload) => ipcRenderer.invoke('securepad:auth-login', payload),
    logout: () => ipcRenderer.invoke('securepad:auth-logout'),
  },
  stats: {
    completeDailyGoal: () => ipcRenderer.invoke('securepad:stats-complete-goal'),
  },
});

