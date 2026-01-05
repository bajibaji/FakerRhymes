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
  const chunkSize = 2000; 

  return new Promise((resolve, reject) => {
    async function processNextBatch() {
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
            message: `正在存储到本地: ${progress}%`
          });

          if (i < total) {
            setTimeout(processNextBatch, 10);
          } else {
            resolve();
          }
        };

        transaction.onerror = (e) => {
          console.error('IndexedDB transaction error:', e.target.error);
          reject(e.target.error);
        };

        transaction.onabort = (e) => {
          console.error('IndexedDB transaction aborted:', e.target.error);
          reject(new Error('Transaction aborted'));
        };
      } catch (err) {
        reject(err);
      }
    }

    // Clear the store before starting
    try {
      const clearTransaction = db.transaction([STORE_NAME], 'readwrite');
      clearTransaction.objectStore(STORE_NAME).clear();
      clearTransaction.oncomplete = () => processNextBatch();
      clearTransaction.onerror = (e) => reject(e.target.error);
    } catch (err) {
      reject(err);
    }
  });
}

self.onmessage = async function(event) {
  const { action, payload } = event.data;
  console.log('Worker received action:', action);

  if (action === 'loadAndProcess') {
    try {
      const { dictSources } = payload;
      
      for (const source of dictSources) {
        try {
          console.log('Processing source:', source.name);
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

          // Use Response.json() for potentially faster native parsing
          const data = await response.json();
          console.log('Data fetched and parsed for:', source.name);
          
          // Re-encode keys and extract unique characters
          const uniqueChars = new Set();
          const optimizedDict = {};
          const keys = Object.keys(data);
          
          // Optimized processing loop
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

          console.log('Unique chars identified:', uniqueChars.size);

          if (uniqueChars.size > 0) {
            await saveToDB(optimizedDict);
            console.log('Saved to IndexedDB');

            self.postMessage({
              type: 'success',
              data: {
                chars: Array.from(uniqueChars),
                sourceName: source.name,
                count: uniqueChars.size
              }
            });
            return;
          }
        } catch (err) {
          console.error(`Error processing source ${source.name}:`, err);
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
      console.error('Worker top-level error:', err);
      self.postMessage({
        type: 'error',
        message: `Worker 错误: ${err.message}`
      });
    }
  }
};
