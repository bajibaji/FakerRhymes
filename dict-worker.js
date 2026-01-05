/**
 * Web Worker for background dictionary loading and processing
 * Optimized for mobile: Fast loading, skip heavy character extraction
 */

// Final to short code mapping
const finalToCode = {
  'iong': '0', 'uang': '1', 'iang': '2', 'ueng': '3', 'uan': '4', 'ian': '5', 'uen': '6', 'iao': '7', 'uai': '8',
  'ang': '9', 'eng': 'a', 'ing': 'b', 'ong': 'c', 'ai': 'd', 'ei': 'e', 'ao': 'f', 'ou': 'g', 'an': 'h', 'en': 'i',
  'in': 'j', 'un': 'k', 'vn': 'l', 'ia': 'm', 'ua': 'n', 'uo': 'o', 'ie': 'p', 'ue': 'q', 'ui': 'r', 'er': 's',
  'a': 't', 'o': 'u', 'e': 'v', 'i': 'w', 'u': 'x', 'v': 'y', 'i-flat': 'z', 'i-retro': 'A', 'ü': 'B', 'üan': 'C', 'ün': 'D'
};

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

/**
 * Saves data chunks to IndexedDB
 */
async function saveToDB(data, startProgress = 0) {
  const db = await openDB();
  const keys = Object.keys(data);
  const total = keys.length;
  let i = 0;
  const chunkSize = 8000; // Increased chunk size for faster storage

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
          const totalProgress = startProgress + Math.round((i / total) * (100 - startProgress));
          
          self.postMessage({
            type: 'parsing',
            progress: totalProgress,
            message: `正在存储: ${totalProgress}%`
          });

          if (i < total) {
            // Minimal delay for maximum speed
            setTimeout(processNextBatch, 0); 
          } else {
            resolve();
          }
        };
        transaction.onerror = (e) => reject(e.target.error);
      } catch (err) {
        reject(err);
      }
    }
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
          self.postMessage({ type: 'progress', message: '正在加载资源...' });
          
          const response = await fetch(source.url);
          if (!response.ok) throw new Error('HTTP ' + response.status);

          let jsonStr = await response.text();
          
          self.postMessage({ type: 'progress', message: '资源加载完成，极速解析中...' });
          let data = JSON.parse(jsonStr);
          jsonStr = null; 
          
          const keys = Object.keys(data);
          const totalKeys = keys.length;
          
          const optimizedDict = {};
          
          // FAST TRACK: Skip unique character extraction completely
          // Processing in batches but without await inside the inner loop for extreme speed
          const batchSize = 10000;
          for (let i = 0; i < totalKeys; i += batchSize) {
            const end = Math.min(i + batchSize, totalKeys);
            for (let j = i; j < end; j++) {
              const key = keys[j];
              optimizedDict[encodeKey(key)] = data[key];
            }
            
            self.postMessage({
              type: 'parsing',
              progress: Math.round((i / totalKeys) * 15)
            });
          }
          
          data = null; 
          console.log('Optimized dictionary ready, saving to DB...');
          // Mapping DB storage to 20-100%
          await saveToDB(optimizedDict, 20);
          
          self.postMessage({
            type: 'success',
            data: {
              chars: [], 
              sourceName: source.name,
              count: totalKeys // Just use key count as estimate
            }
          });

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
