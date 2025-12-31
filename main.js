const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const path = require('path');
const { GoogleGenAI } = require("@google/genai");
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');
const nodeFetch = require('node-fetch');

// 处理 Gemini API 请求
ipcMain.handle('generate-content', async (event, apiKey, prompt, proxyUrl) => {
  // 保存原始 fetch，虽然我们可能不会恢复它，但在 Electron 中最好小心
  const originalFetch = global.fetch;

  try {
    let agent;

    if (proxyUrl) {
      // 1. 规范化代理 URL
      if (!proxyUrl.includes('://')) {
         proxyUrl = `http://${proxyUrl}`;
      }
      console.log(`[Gemini] Using proxy: ${proxyUrl}`);

      // 2. 根据协议选择 Agent
      if (proxyUrl.startsWith('socks')) {
        agent = new SocksProxyAgent(proxyUrl);
      } else {
        // HTTP/HTTPS 代理
        // rejectUnauthorized: false 允许自签名证书，防止代理报错
        agent = new HttpsProxyAgent(proxyUrl, { rejectUnauthorized: false });
      }
    } else {
      console.log(`[Gemini] Direct connection (no proxy)`);
    }

    // 3. 关键步骤：完全接管 global.fetch
    // 官方 SDK 使用 global.fetch，我们用 node-fetch + agent 替换它
    global.fetch = (url, init) => {
      return nodeFetch(url, { ...init, agent: agent });
    };
    
    // 4. 补全 node-fetch 需要的全局对象
    if (!global.Headers) global.Headers = nodeFetch.Headers;
    if (!global.Request) global.Request = nodeFetch.Request;
    if (!global.Response) global.Response = nodeFetch.Response;

    // 5. 初始化 SDK 并调用
    const genAI = new GoogleGenAI({ apiKey });
    
    const result = await genAI.models.generateContent({
      model: "gemini-2.0-flash",
      contents: prompt
    });
    
    return { success: true, text: result.text };

  } catch (error) {
    console.error("Gemini API Error:", error);
    return { success: false, error: `${error.message} (Proxy: ${proxyUrl || 'None'})` };
  } finally {
    // 恢复环境，避免影响应用其他部分的 fetch 请求
    if (originalFetch) global.fetch = originalFetch;
  }
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 1080,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, 'icon.png'), // 可选：如有图标
  });

  // 隐藏菜单栏
  Menu.setApplicationMenu(null);

  win.loadFile('index.html');

  // 自定义滚动栏样式
  win.webContents.on('did-finish-load', () => {
    win.webContents.insertCSS(`
      ::-webkit-scrollbar {
        width: 10px;
        height: 10px;
      }
      ::-webkit-scrollbar-track {
        background: transparent;
      }
      ::-webkit-scrollbar-thumb {
        background: linear-gradient(180deg, #1f0f3aff 0%, #093f47ff 100%);
        border-radius: 5px;
      }
      ::-webkit-scrollbar-thumb:hover {
        background: linear-gradient(180deg, #1fb6ce6b 0%, #7c3aed60 100%);
      }
    `);
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
