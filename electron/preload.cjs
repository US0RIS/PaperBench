const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('paperDesktop', {
  isDesktop: true,
  saveFile: (payload) => ipcRenderer.invoke('paperbench:save-file', payload),
  appInfo: () => ipcRenderer.invoke('paperbench:app-info'),
  onOpenAssist: (fn) => {
    const handler = () => fn();
    ipcRenderer.on('paperbench:open-assist', handler);
    return () => ipcRenderer.removeListener('paperbench:open-assist', handler);
  },
});
