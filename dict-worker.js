/**
 * Web Worker for background dictionary loading and processing
 * This runs in a separate thread to avoid blocking the main UI thread
 */

// Final to short code mapping
const finalToCode = {
  'iong': '0', 'uang': '1', 'iang': '2', 'ueng': '3', 'uan': '4', 'ian': '5', 'uen': '6', 'iao': '7', 'uai': '8',
  'ang': '9', 'eng': 'a', 'ing': 'b', 'ong': 'c', 'ai': 'd', 'ei': 'e', 'ao': 'f', 'ou': 'g', 'an': 'h', 'en': 'i',
  'in': 'j', 'un': 'k', 'vn': 'l', 'ia': 'm', 'ua': 'n', 'uo': 'o', 'ie': 'p', 'ue': 'q', 'ui': 'r', 'er': 's',
  'a': 't', 'o': 'u', 'e': 'v', 'i': 'w', 'u': 'x', 'v': 'y', 'i-flat': 'z', 'i-retro': 'A', 'ü': 'B', 'üan': 'C', 'ün': 'D'
};

const codeToFinal = Object.fromEntries(Object.entries(finalToCode).map(([k, v]) => [v, k]));

function encodeKey(key) {
  if (!key) return key;
  return key.split('_').map(part => {
    const match = part.match(/^(.+)([0-4])$/);
    if (match) {
      const [_, final, tone] = match;
      return (finalToCode[final] || final) + tone;
    }
    return part;
  }).join('');
}

function decodeKey(encodedKey) {
  if (!encodedKey) return encodedKey;
  let decoded = [];
  for (let i = 0; i < encodedKey.length; i += 2) {
    const code = encodedKey[i];
    const tone = encodedKey[i + 1];
    decoded.push((codeToFinal[code] || code) + tone);
  }
  return decoded.join('_');
}

// IndexedDB helpers
const DB_NAME = 'FakerRhymesDB';
const DB_VERSION = 1;
const STORE_NAME = 'dictionary';

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

async function saveToDB(data) {
  const db = await openDB();
  const keys = Object.keys(data);
  const total = keys.length;
  let i = 0;
  const chunkSize = 5000; // 增大分片以减少事务开销

  return new Promise((resolve, reject) => {
    function processNextBatch() {
      try {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        
        const limit = Math.min(i + chunkSize, total);
        for (; i < limit; i++) {
          store.put(data[keys[i]], keys[i]);
        }

        transaction.oncomplete = () => {
          const progress = Math.round((i / total) * 100);
          self.postMessage({
            type: 'parsing',
            progress: progress,
            message: `正在存储: ${progress}%`
          });

          if (i < total) {
            // 手机端关键：给 UI 线程留出更多喘息时间
            setTimeout(processNextBatch, 50);
          } else {
            resolve();
          }
        };

        transaction.onerror = (e) => reject(e.target.error);
        transaction.onabort = (e) => reject(new Error('Transaction aborted'));
      } catch (err) {
        reject(err);
      }
    }

    // 清理逻辑移出此处，在主线程控制
    processNextBatch();
  });
}

self.onmessage = async function(event) {
  const { action, payload } = event.data;

  if (action === 'loadAndProcess') {
    try {
      const { dictSources } = payload;
      
      for (const source of dictSources) {
        try {
          const response = await fetch(source.url);
          if (!response.ok) throw new Error('HTTP ' + response.status);

          // 核心优化：使用流式解析减少内存占用
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let data = null;

          self.postMessage({ type: 'progress', message: '正在获取词库...' });

          // 如果文件不是特别大，原生 JSON.parse 依然是最快的
          // 这里我们采用渐进式读取
          const chunks = [];
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
          }
          
          const blob = new Blob(chunks);
          const jsonStr = await blob.text();
          data = JSON.parse(jsonStr);
          
          console.log('JSON 解析完成');
          
          // 优化处理循环
          const uniqueChars = new Set();
          const optimizedDict = {};
          const keys = Object.keys(data);
          
          for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            const value = data[key];
            const encoded = encodeKey(key);
            optimizedDict[encoded] = value;
            
            if (Array.isArray(value)) {
              for (const word of value) {
                for (const char of word) {
                  if (char >= '\u4e00' && char <= '\u9fa5') uniqueChars.add(char);
                }
              }
            }
            
            if (i % 20000 === 0) {
              self.postMessage({
                type: 'parsing',
                progress: Math.round((i / keys.length) * 50) // 映射到 0-50%
              });
              await new Promise(r => setTimeout(r, 0));
            }
          }

          if (uniqueChars.size > 0) {
            await saveToDB(optimizedDict);
            self.postMessage({
              type: 'success',
              data: {
                chars: [], // 不再传递巨大数组
                sourceName: source.name,
                count: uniqueChars.size
              }
            });
            return;
          }
        } catch (err) {
          self.postMessage({ type: 'error', message: err.message });
        }
      }
    } catch (err) {
      self.postMessage({ type: 'error', message: err.message });
    }
  } else if (action === 'clearCache') {
    try {
      const db = await openDB();
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      transaction.objectStore(STORE_NAME).clear();
      transaction.oncomplete = () => self.postMessage({ type: 'clearSuccess' });
    } catch (err) {
      self.postMessage({ type: 'error', message: err.message });
    }
  }
};
