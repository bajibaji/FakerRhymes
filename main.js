const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const path = require('path');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');
const nodeFetch = require('node-fetch');

// 全局异常捕获，防止 Socket 错误导致应用崩溃
process.on('uncaughtException', (error) => {
  console.error('[Uncaught Exception]', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Unhandled Rejection]', reason);
});

// 处理 Gemini API 请求
ipcMain.handle('generate-content', async (event, apiKey, prompt, proxyUrl, modelName) => {
  try {
    let agent = null;

    if (proxyUrl) {
      if (!proxyUrl.includes('://')) {
         proxyUrl = `http://${proxyUrl}`;
      }

      if (proxyUrl.startsWith('socks')) {
        agent = new SocksProxyAgent(proxyUrl);
      } else {
        // 使用更兼容的配置
        const options = {
          rejectUnauthorized: false,
          keepAlive: true,
          scheduling: 'lifo',
          timeout: 20000
        };
        agent = new HttpsProxyAgent(proxyUrl, options);
      }
    }

    // 使用 node-fetch 并配合代理
    const customFetch = async (url, init) => {
      try {
        return await nodeFetch(url, {
          ...init,
          agent,
          timeout: 60000
        });
      } catch (fetchErr) {
        // 捕获可能从 fetch 逃逸的 Socket 错误
        console.error('[Fetch Internal Error]', fetchErr);
        throw fetchErr;
      }
    };

    if (agent) {
        // 彻底覆盖全局 fetch 接口
        global.fetch = customFetch;
        globalThis.fetch = customFetch;
    }

    // 直接在构造函数或 getGenerativeModel 中显式指定 apiClient 或自定义 fetch
    // 某些版本的 SDK 允许通过 RequestOptions 传递 fetchFn
    const genAI = new GoogleGenerativeAI(apiKey);

    const model = genAI.getGenerativeModel(
      { model: modelName || "gemini-2.0-flash" },
      {
        apiVersion: 'v1alpha',
        // 强制指定自定义 fetch 函数，绕过全局 fetch 检测
        // @ts-ignore
        fetchFn: customFetch
      }
    );

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    return { success: true, text: text };

  } catch (error) {
    // 增加详细的错误日志捕获，根据 SDK 文档
    console.error("=== Gemini API Error Details ===");
    console.error("Message:", error.message);
    
    // 检查是否为 SDK 定义的错误
    if (error.response) {
      try {
        const details = error.response;
        console.error("Status:", details.status);
        console.error("Status Text:", details.statusText);
        // 如果有更详细的错误信息
        if (details.promptFeedback) {
          console.error("Prompt Feedback:", JSON.stringify(details.promptFeedback));
        }
      } catch (e) {}
    }

    if (error.stack) {
      console.error("Stack Trace:", error.stack);
    }
    
    // 如果存在 cause (Node.js 16.9.0+)
    if (error.cause) {
      console.error("Cause:", error.cause);
    }
    console.error("===============================");

    let friendlyError = error.message;
    if (error.message.includes('socket hang up') || error.message.includes('ECONNRESET')) {
      friendlyError = `模型请求失败 (${modelName})。原因可能是模型名称不存在、您的 API Key 权限不足，或代理服务器断开连接。请尝试使用 gemini-2.0-flash。`;
    }
    return { success: false, error: `Gemini API Error: ${friendlyError}` };
  }
});

function createWindow() {
  console.log('[DEBUG] 开始创建窗口...');
  console.log('[DEBUG] 图标路径:', path.join(__dirname, 'icon.ico'));
  
  const win = new BrowserWindow({
    width: 1000,
    height: 1080,
    show: false, // 先隐藏窗口，等待内容加载完成
    backgroundColor: '#1b0d22', // 设置背景色避免白屏
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, 'icon.ico'), // 修正：使用正确的图标文件扩展名
  });

  console.log('[DEBUG] BrowserWindow 创建完成，当前 show 状态:', win.isVisible());
  console.log('[DEBUG] 窗口初始大小:', win.getSize());

  // 注释掉 DevTools 自动打开，避免影响窗口布局
  // win.webContents.openDevTools();

  Menu.setApplicationMenu(null);
  
  console.log('[DEBUG] 开始加载 index.html...');
  win.loadFile('index.html');

  // 等待内容渲染完成后再显示窗口，避免闪烁
  win.once('ready-to-show', () => {
    console.log('[DEBUG] ready-to-show 事件触发');
    console.log('[DEBUG] 显示前窗口大小:', win.getSize());
    win.show();
    console.log('[DEBUG] 窗口已显示，当前大小:', win.getSize());
  });

  win.webContents.on('did-finish-load', () => {
    win.webContents.insertCSS(`
      ::-webkit-scrollbar { width: 10px; height: 10px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb {
        background: linear-gradient(180deg, #1f0f3aff 0%, #093f47ff 100%);
        border-radius: 5px;
      }
    `);
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
