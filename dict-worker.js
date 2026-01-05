(function() {
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

  self.onmessage = async function(event) {
    const { action, payload } = event.data;

    if (action === 'loadAndProcess') {
      try {
        const { dictSources } = payload;
        
        for (const source of dictSources) {
          try {
            self.postMessage({ type: 'progress', message: `加载中: ${source.name}...` });

            const response = await fetch(source.url);
            if (!response.ok) throw new Error('HTTP ' + response.status);

            const data = await response.json();
            
            const optimizedDict = {};
            const suffixMap = {}; // 新增：后缀索引

            const entries = Object.entries(data);
            const total = entries.length;

            entries.forEach(([key, value], idx) => {
              if (idx % 5000 === 0) {
                self.postMessage({ type: 'progress', message: `处理索引: ${Math.round((idx / total) * 100)}%` });
              }

              const encoded = encodeKey(key);
              optimizedDict[encoded] = value;

              // 建立后缀索引
              // 这里的策略是：对于每个词典条目，它的 key 是 encoded 形式（如 "w1h4"）
              // 我们将它的所有可能的后缀存入 suffixMap
              // 比如 "w1h4" 的后缀有 "h4" 和 "w1h4"
              for (let i = 0; i < encoded.length; i += 2) {
                const suffix = encoded.slice(i);
                if (!suffixMap[suffix]) suffixMap[suffix] = [];
                suffixMap[suffix].push(encoded);
              }
            });

            const { chars, stats } = processDict(optimizedDict);

            self.postMessage({
              type: 'success',
              data: {
                chars,
                optimizedDict,
                suffixMap, // 发送回主线程
                sourceName: source.name,
                stats
              }
            });
            return;
          } catch (err) {
            self.postMessage({ type: 'error', message: `${source.name} 加载失败: ${err.message}` });
          }
        }
        self.postMessage({ type: 'error', message: '所有词库源均加载失败' });
      } catch (err) {
        self.postMessage({ type: 'error', message: `Worker 错误: ${err.message}` });
      }
    }
  };

  function processDict(data) {
    const chars = new Set();
    let stats = { totalStrings: 0, totalChars: 0, uniqueChars: 0, categories: 0 };
    const entries = Object.entries(data);
    stats.categories = entries.length;
    
    entries.forEach(([key, value]) => {
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

    stats.uniqueChars = chars.size;
    return { chars: Array.from(chars), stats };
  }
})();
