const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  generateContent: (apiKey, prompt, proxyUrl, modelName) => {
    // 输入验证
    if (!apiKey || typeof apiKey !== 'string') {
      return Promise.resolve({ success: false, error: '无效的 API Key' });
    }
    if (!prompt || typeof prompt !== 'string') {
      return Promise.resolve({ success: false, error: '无效的 Prompt' });
    }
    
    return ipcRenderer.invoke('generate-content', apiKey, prompt, proxyUrl, modelName);
  }
});
