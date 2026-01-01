/**
 * Web Worker for background dictionary loading and processing
 * Optimized for mobile: avoids memory spikes during saving
 */

const DB_NAME = 'FakerRhymesDB';
const DB_VERSION = 2;
const STORE_NAME = 'dictionary';
const META_STORE = 'metadata';

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
            if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
        };
        request.onsuccess = (event) => resolve(event.target.result);
        request.onerror = (event) => reject(event.target.error);
    });
}

async function saveToDBInChunks(dictData, chars, stats, sourceName) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME, META_STORE], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const meta = transaction.objectStore(META_STORE);
        
        store.clear();
        
        // Use keys to iterate and save individually to avoid large single put()
        const keys = Object.keys(dictData);
        for (const key of keys) {
            store.put(dictData[key], key);
        }

        meta.put({
            chars,
            stats,
            sourceName,
            timestamp: Date.now()
        }, 'info');

        transaction.oncomplete = () => resolve();
        transaction.onerror = (event) => reject(event.target.error);
    });
}

self.onmessage = async function(event) {
  const { action, payload } = event.data;

  if (action === 'loadAndProcess') {
    try {
      const { dictSources } = payload;
      
      for (const source of dictSources) {
        try {
          self.postMessage({ type: 'progress', message: `正在获取词库...` });

          const response = await fetch(source.url);
          if (!response.ok) throw new Error('HTTP ' + response.status);

          // Use blob to reduce memory string concatenation
          const blob = await response.blob();
          self.postMessage({ type: 'progress', message: '正在解析数据...' });
          
          const text = await blob.text();
          const dictData = JSON.parse(text);
          
          self.postMessage({ type: 'progress', message: '正在处理词库...' });
          const { chars, stats } = processDict(dictData);

          self.postMessage({ type: 'progress', message: '正在安全存入数据库...' });
          await saveToDBInChunks(dictData, chars, stats, source.name);

          self.postMessage({
            type: 'success',
            data: { chars, sourceName: source.name, stats }
          });
          return;
        } catch (err) {
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
    for (const key in data) {
      const value = data[key];
      if (Array.isArray(value)) {
        totalStrings += value.length;
        for (const word of value) {
          if (typeof word === 'string') {
            for (const ch of word) {
              if (ch >= '\u4e00' && ch <= '\u9fa5') {
                totalChars++;
                chars.add(ch);
              }
            }
          }
        }
      }
    }
  }
  return {
    chars: Array.from(chars),
    stats: { totalStrings, totalChars, uniqueChars: chars.size }
  };
}
