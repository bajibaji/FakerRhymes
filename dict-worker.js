/**
 * Web Worker for background dictionary loading and processing
 * Optimized to handle large files and use IndexedDB
 */

// Import DB logic if possible, or redefine basic IDB for worker
const DB_NAME = 'FakerRhymesDB';
const DB_VERSION = 1;
const STORE_NAME = 'dictionary';

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        request.onsuccess = (event) => resolve(event.target.result);
        request.onerror = (event) => reject(event.target.error);
    });
}

async function saveToDB(data) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(data, 'full_dict');
        request.onsuccess = () => resolve();
        request.onerror = (event) => reject(event.target.error);
    });
}

self.onmessage = async function(event) {
  const { action, payload } = event.data;

  if (action === 'loadAndProcess') {
    try {
      const { dictSources } = payload;
      
      for (const source of dictSources) {
        try {
          self.postMessage({ type: 'progress', message: `正在从网络获取: ${source.name}...` });

          const response = await fetch(source.url);
          if (!response.ok) throw new Error('HTTP ' + response.status);

          const contentLength = response.headers.get('content-length');
          const total = parseInt(contentLength, 10);
          const reader = response.body.getReader();
          
          let receivedLength = 0;
          let chunks = [];

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            receivedLength += value.length;

            if (total) {
              const progress = Math.round((receivedLength / total) * 100);
              if (progress % 5 === 0) { // Reduce message frequency
                self.postMessage({
                  type: 'progress',
                  message: `下载中: ${progress}%`,
                  percent: progress
                });
              }
            }
          }

          self.postMessage({ type: 'progress', message: '下载完成，正在解析 JSON...' });
          
          const allChunks = new Uint8Array(receivedLength);
          let position = 0;
          for (const chunk of chunks) {
            allChunks.set(chunk, position);
            position += chunk.length;
          }
          
          const jsonStr = new TextDecoder().decode(allChunks);
          const dictData = JSON.parse(jsonStr);
          
          self.postMessage({ type: 'progress', message: '正在提取汉字字库...' });
          const { chars, stats } = processDict(dictData);

          self.postMessage({ type: 'progress', message: '正在存入本地数据库 (IndexedDB)...' });
          
          // Save both the full dictionary and the unique chars
          await saveToDB({
              full: dictData,
              chars: chars,
              stats: stats,
              timestamp: Date.now(),
              sourceName: source.name
          });

          self.postMessage({
            type: 'success',
            data: {
              chars,
              sourceName: source.name,
              stats
            }
          });
          return;
        } catch (err) {
          console.error(err);
          self.postMessage({ type: 'error', message: `${source.name} 失败: ${err.message}` });
        }
      }
    } catch (err) {
      self.postMessage({ type: 'error', message: `Worker 异常: ${err.message}` });
    }
  }
};

function processDict(data) {
  const chars = new Set();
  let totalStrings = 0;
  let totalChars = 0;

  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const entries = Object.entries(data);
    entries.forEach(([key, value]) => {
      if (Array.isArray(value)) {
        totalStrings += value.length;
        value.forEach(word => {
          if (typeof word === 'string') {
            for (const ch of word) {
              if (/[\u4e00-\u9fa5]/.test(ch)) {
                totalChars++;
                chars.add(ch);
              }
            }
          }
        });
      }
    });
  } else if (Array.isArray(data)) {
      data.forEach(item => {
          const word = typeof item === 'string' ? item : (item.word || item.char);
          if (word) {
              totalStrings++;
              for (const ch of word) {
                  if (/[\u4e00-\u9fa5]/.test(ch)) {
                      totalChars++;
                      chars.add(ch);
                  }
              }
          }
      });
  }

  return {
    chars: Array.from(chars),
    stats: {
      totalStrings,
      totalChars,
      uniqueChars: chars.size
    }
  };
}
