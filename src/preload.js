const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('murmur', {
  onStart: (cb) => ipcRenderer.on('start', cb),
  onStop: (cb) => ipcRenderer.on('stop', cb),
  onCancel: (cb) => ipcRenderer.on('cancel', cb),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  sendAudio: (buf) => ipcRenderer.send('audio', buf),
  micError: (msg) => ipcRenderer.send('mic-error', msg),
});
