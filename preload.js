const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  generateContent: (apiKey, prompt, proxyUrl) => ipcRenderer.invoke('generate-content', apiKey, prompt, proxyUrl)
});
