const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('myarc', {
  dispatch: (action) => ipcRenderer.send('action', action),
  onState: (callback) => ipcRenderer.on('state', (_event, state) => callback(state)),
  onCommand: (callback) => ipcRenderer.on('command', (_event, command) => callback(command)),
})
