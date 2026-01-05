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
  // This is trickier because encoded parts are not separated by underscores in the most compact form
  // But our current keys are like "i1_an4", let's assume we want to compress it to "w1h4"
  let decoded = [];
  for (let i = 0; i < encodedKey.length; i += 2) {
    const code = encodedKey[i];
    const tone = encodedKey[i + 1];
    decoded.push((codeToFinal[code] || code) + tone);
  }
  return decoded.join('_');
}

self.onmessage = async function(event) {
  const { action, payload } = event.data;

  if (action === 'loadAndProcess') {
    try {
      const { dictSources } = payload;
      
      for (const source of dictSources) {
        try {
          // Report progress
          self.postMessage({
            type: 'progress',
            message: `加载中: ${source.name}`
          });

          const response = await fetch(source.url, {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
          });

          if (!response.ok) {
            throw new Error('HTTP ' + response.status);
          }

          // Stream large files in chunks for better progress reporting
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
                message: `下载中: ${progress}%`,
                percent: progress
              });
            }
          }

          const chunksAll = new Uint8Array(receivedLength);
          let position = 0;
          for (const chunk of chunks) {
            chunksAll.set(chunk, position);
            position += chunk.length;
          }

          const decoder = new TextDecoder();
          const jsonStr = decoder.decode(chunksAll);
          
          self.postMessage({
            type: 'progress',
            message: `解析${source.name}`
          });

          const data = JSON.parse(jsonStr);
          
          // Re-encode keys for more efficient storage if needed
          const optimizedDict = {};
          for (const [key, value] of Object.entries(data)) {
            optimizedDict[encodeKey(key)] = value;
          }

          const { chars, stats } = processDict(optimizedDict);

          if (chars && chars.length > 0) {
            self.postMessage({
              type: 'success',
              data: {
                chars,
                optimizedDict, // Send back encoded dictionary
                sourceName: source.name,
                count: chars.length,
                stats  // 传递详细统计信息
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

/**
 * Process dictionary data and extract Chinese characters
 * Supports multiple dictionary formats
 * Returns { uniqueChars, stats } for better visibility
 */
function processDict(data) {
  const chars = new Set();
  let stats = {
    totalStrings: 0,
    totalChars: 0,        // 汉字总数（计重复）
    uniqueChars: 0,       // 去重后的唯一汉字数
    categories: 0         // 分类数量（如果是对象格式）
  };

  if (Array.isArray(data)) {
    // Array of strings or objects
    stats.categories = 1;
    data.forEach((item, idx) => {
      if (idx % 1000 === 0) {
        // Report progress every 1000 items
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
    // Object with character arrays by rhyme/key
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
