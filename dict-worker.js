/**
 * Web Worker for background dictionary loading and processing
 * This runs in a separate thread to avoid blocking the main UI thread
 */

<<<<<<< HEAD
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
  const chunkSize = 2000; // Reduced chunk size for better responsiveness

  return new Promise((resolve, reject) => {
<<<<<<< HEAD
    function processNextBatch() {
      // Create a new transaction for each batch to avoid long-running transaction issues
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
          message: `正在存储到本地: ${progress}%`
        });

        if (i < total) {
          // Use a small delay to allow message passing and avoid event loop starvation
          setTimeout(processNextBatch, 10);
        } else {
          resolve();
        }
      };

      transaction.onerror = (e) => {
        console.error('IndexedDB transaction error:', e.target.error);
        reject(e.target.error);
      };

      // In case the transaction is aborted
      transaction.onabort = (e) => {
        console.error('IndexedDB transaction aborted:', e.target.error);
        reject(new Error('Transaction aborted'));
      };
=======
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    
    // Clear existing data
    store.clear();
    
    // Add data in chunks to avoid blocking
    const keys = Object.keys(data);
    let i = 0;
    const chunkSize = 1000;
    
    function addNextChunk() {
      const limit = Math.min(i + chunkSize, keys.length);
      for (; i < limit; i++) {
        store.put(data[keys[i]], keys[i]);
      }
      
      if (i < keys.length) {
        setTimeout(addNextChunk, 0);
      } else {
        resolve();
      }
>>>>>>> parent of 2fb5f8f (4)
    }

    // Clear the store before starting
    const clearTransaction = db.transaction([STORE_NAME], 'readwrite');
    clearTransaction.objectStore(STORE_NAME).clear();
    clearTransaction.oncomplete = () => processNextBatch();
    clearTransaction.onerror = (e) => reject(e.target.error);
  });
}

=======
>>>>>>> parent of 7108827 (优化查询速度 v1.7.0)
self.onmessage = async function(event) {
  const { action, payload } = event.data;

  if (action === 'loadAndProcess') {
    try {
      const { dictSources } = payload;
      
      for (const source of dictSources) {
        try {
          self.postMessage({
            type: 'progress',
            message: `加载中: ${source.name}...`
          });

          const response = await fetch(source.url, {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
          });

          if (!response.ok) {
            throw new Error('HTTP ' + response.status);
          }

          const contentLength = response.headers.get('content-length');
          const total = parseInt(contentLength, 10);
          const reader = response.body.getReader();
          let receivedLength = 0;
          const chunks = [];

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            receivedLength += value.length;

            if (total) {
              const progress = Math.round((receivedLength / total) * 100);
              self.postMessage({
                type: 'progress',
                message: `下载中: ${source.name}... ${progress}%`,
                percent: progress
              });
            }
          }

          self.postMessage({
            type: 'progress',
<<<<<<< HEAD
            message: `解析${source.name}...`
=======
            message: `解析中: ${source.name}...`
>>>>>>> parent of c4c37cd (Revert "1.7.1 web update")
          });

<<<<<<< HEAD
          // Use Response.json() for potentially faster native parsing
          const data = await response.json();
          
          // Re-encode keys and extract unique characters
          const uniqueChars = new Set();
          const optimizedDict = {};
          const keys = Object.keys(data);
          
          // Optimized processing loop with larger yield steps
          for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            const value = data[key];
            const encoded = encodeKey(key);
            optimizedDict[encoded] = value;
            
            if (Array.isArray(value)) {
              for (let j = 0; j < value.length; j++) {
                const word = value[j];
                for (let k = 0; k < word.length; k++) {
                  const char = word[k];
                  if (char >= '\u4e00' && char <= '\u9fa5') uniqueChars.add(char);
                }
              }
            }
            
            if (i % 20000 === 0) {
              self.postMessage({
                type: 'parsing',
                progress: Math.round((i / keys.length) * 100)
              });
              await new Promise(r => setTimeout(r, 0));
            }
          }

          if (uniqueChars.size > 0) {
            await saveToDB(optimizedDict);
=======
          const data = JSON.parse(jsonStr);
          const { chars, stats } = processDict(data);
>>>>>>> parent of 7108827 (优化查询速度 v1.7.0)

            self.postMessage({
              type: 'success',
              data: {
<<<<<<< HEAD
                chars: Array.from(uniqueChars),
=======
                chars,
>>>>>>> parent of 7108827 (优化查询速度 v1.7.0)
                sourceName: source.name,
                count: uniqueChars.size
              }
            });
            return;
          }
        } catch (err) {
          self.postMessage({
            type: 'error',
            message: `${source.name} 加载失败: ${err.message}`
          });
          continue;
        }
      }

      self.postMessage({
        type: 'error',
        message: '所有词库源均加载失败'
      });
    } catch (err) {
      self.postMessage({
        type: 'error',
        message: `Worker 错误: ${err.message}`
      });
    }
  }
};

function processDict(data) {
  const chars = new Set();
  let stats = {
    totalStrings: 0,
    totalChars: 0,
    uniqueChars: 0,
    categories: 0
  };

  if (Array.isArray(data)) {
    stats.categories = 1;
    data.forEach((item, idx) => {
      if (idx % 1000 === 0) {
        self.postMessage({
          type: 'parsing',
          progress: Math.round((idx / data.length) * 100)
        });
      }

      if (typeof item === 'string') {
        stats.totalStrings++;
        Array.from(item).forEach(ch => {
          if (/[\u4e00-\u9fa5]/.test(ch)) {
            stats.totalChars++;
            chars.add(ch);
          }
        });
      } else if (item && (item.word || item.char)) {
        stats.totalStrings++;
        const word = item.word || item.char;
        Array.from(word).forEach(ch => {
          if (/[\u4e00-\u9fa5]/.test(ch)) {
            stats.totalChars++;
            chars.add(ch);
          }
        });
      }
    });
  } else if (data && typeof data === 'object') {
    const entries = Object.entries(data);
    stats.categories = entries.length;
    
    entries.forEach(([key, value], idx) => {
      if (idx % 5000 === 0) {
        self.postMessage({
          type: 'parsing',
          progress: Math.round((idx / entries.length) * 100)
        });
      }

      if (Array.isArray(value)) {
        stats.totalStrings += value.length;
        value.forEach(item => {
          if (typeof item === 'string') {
            Array.from(item).forEach(ch => {
              if (/[\u4e00-\u9fa5]/.test(ch)) {
                stats.totalChars++;
                chars.add(ch);
              }
            });
          }
        });
      }
    });
  }

  stats.uniqueChars = chars.size;
  return { chars: Array.from(chars), stats };
}
