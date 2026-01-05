/**
 * 字典管理模块 - 处理词库加载和查询
 * @module dict-manager
 */

(function() {
// 引用韵脚引擎
const { buildKeyVariants, getLoosenessTier, buildFinalVariants, toInfo, phraseFitsSource, devLog } = window.RhymeEngine || {};

// 全局变量
let dict = null;
let dictIndex = new Map(); // 新增：用于快速匹配的索引
let bankMap = new Map();
let customCache = []; // 自定义词库内存缓存

/**
 * 预加载自定义词库到内存
 */
const preloadCustomBank = async () => {
	if (window.DB) {
		try {
			customCache = await window.DB.getAll();
			devLog && devLog('自定义词库预加载成功,共', customCache.length, '条');
		} catch (e) {
			console.warn('自定义词库预加载失败:', e);
		}
	}
};

/**
 * 构建字典索引
 * 使用 requestIdleCallback 分片构建，避免阻塞主线程
 */
const buildDictIndex = async () => {
	if (!dict) return;
	dictIndex = new Map();
	
	const entries = Object.entries(dict);
	const total = entries.length;
	let current = 0;
	const batchSize = 500; // 每批处理的数量

	const processBatch = (deadline) => {
		while ((deadline.timeRemaining() > 0 || deadline.didTimeout) && current < total) {
			const end = Math.min(current + batchSize, total);
			for (let i = current; i < end; i++) {
				const [dictKey, candidates] = entries[i];
				const variants = buildKeyVariants(dictKey);
				for (const variant of variants) {
					const parts = variant.split('_');
					const len = parts.length;
					
					for (let j = 1; j <= Math.min(len, 4); j++) {
						const suffix = parts.slice(-j).join('_');
						const indexKey = `${j}_${suffix}`;
						
						if (!dictIndex.has(indexKey)) {
							dictIndex.set(indexKey, []);
						}
						dictIndex.get(indexKey).push(...candidates);
					}
				}
			}
			current = end;
		}

		if (current < total) {
			requestIdleCallback(processBatch);
		} else {
			// 全部处理完后去重
			requestIdleCallback(deduplicateIndex);
		}
	};

	const deduplicateIndex = (deadline) => {
		const keys = Array.from(dictIndex.keys());
		let keyIdx = 0;
		
		const processDeduplication = (dl) => {
			while ((dl.timeRemaining() > 0 || dl.didTimeout) && keyIdx < keys.length) {
				const key = keys[keyIdx];
				dictIndex.set(key, [...new Set(dictIndex.get(key))]);
				keyIdx++;
			}
			
			if (keyIdx < keys.length) {
				requestIdleCallback(processDeduplication);
			} else {
				devLog && devLog('字典索引异步构建并去重完成');
			}
		};
		
		requestIdleCallback(processDeduplication);
	};

	if (window.requestIdleCallback) {
		requestIdleCallback(processBatch);
	} else {
		// Fallback to setTimeout
		const runSync = () => {
			for (const [dictKey, candidates] of entries) {
				const variants = buildKeyVariants(dictKey);
				for (const variant of variants) {
					const parts = variant.split('_');
					for (let j = 1; j <= Math.min(parts.length, 4); j++) {
						const suffix = parts.slice(-j).join('_');
						const indexKey = `${j}_${suffix}`;
						if (!dictIndex.has(indexKey)) dictIndex.set(indexKey, []);
						dictIndex.get(indexKey).push(...candidates);
					}
				}
			}
			for (const [key, candidates] of dictIndex) {
				dictIndex.set(key, [...new Set(candidates)]);
			}
		};
		setTimeout(runSync, 100);
	}
};

/**
 * 加载优化字典
 * @returns {Promise<void>}
 */
const loadDict = async () => {
	try {
		const resp = await fetch('dict_optimized.json');
		const text = await resp.text();
		dict = JSON.parse(text);
		buildDictIndex(); // 构建索引
		devLog && devLog('字典加载成功,共', Object.keys(dict).length, '条');
	} catch(e) {
		console.error('字典加载失败:', e);
	}
};

/**
 * 注册韵脚库
 * @returns {Map} 韵脚映射表
 */
const registerBank = () => {
	if (!window.pinyinPro || !window.pinyinPro.pinyin) return new Map();
	const source = typeof window.getRhymeBank === 'function' ? window.getRhymeBank() : window.RHYME_CHAR_BANK || [];
	const map = new Map();
	for (const item of source) {
		const chars = Array.from(item);
		for (const ch of chars) {
			const info = toInfo(ch);
			if (!info) continue;
			const key = `${info.fin}-${info.tone}`;
			if (!map.has(key)) map.set(key, []);
			if (!map.get(key).includes(ch)) {
				map.get(key).push(ch);
			}
		}
	}
	return map;
};

/**
 * 从字典查询拼音组合对应的词组
 * @param {Object[]} infos - 拼音信息数组
 * @param {number} looseness - 宽松度
 * @returns {Object|null} 查询结果
 */
const queryDict = (infos, looseness) => {
	if (!infos || infos.length === 0) return null;
	
	let queryInfos = infos;
	const validInfos = queryInfos.filter(info => info.fin && info.fin !== '-');
	if (validInfos.length === 0) return null;
	
	const tier = getLoosenessTier(looseness);
	const allowToneRelax = tier >= 2;
	
	const generateQueryKeys = (infos) => {
		const keys = [];
		const recurse = (index, current) => {
			if (index === infos.length) {
				keys.push(current.join('_'));
				return;
			}
			const info = infos[index];
			const toneVariants = allowToneRelax ? [1,2,3,4] : [info.tone];
			const finVariants = buildFinalVariants(info.fin, tier);
			
			const expandedVariants = new Set();
			for (const v of finVariants) {
				expandedVariants.add(v);
				const legacyMap = window.RhymeEngine?.legacyKeyMap || {};
				if (legacyMap[v]) {
					legacyMap[v].forEach(k => expandedVariants.add(k));
				}
			}

			for (const fin of expandedVariants) {
				for (const tone of toneVariants) {
					recurse(index + 1, [...current, `${fin}${tone}`]);
				}
			}
		};
		recurse(0, []);
		return keys;
	};
	
	// 使用索引优化查询
	const matchedByWordCount = {};
	const sourceLength = infos.length;
	const queryKeys = generateQueryKeys(validInfos);
	const queryVariantSet = new Set();
	queryKeys.forEach(k => {
		buildKeyVariants(k).forEach(v => queryVariantSet.add(v));
	});

	if (dictIndex.size > 0) {
		const queryLen = validInfos.length;
		// 限制匹配长度最大为4，且不超过查询串长度
		const matchLen = Math.min(queryLen, 4);
		
		for (const qk of queryVariantSet) {
			const parts = qk.split('_');
			const suffix = parts.slice(-matchLen).join('_');
			const indexKey = `${matchLen}_${suffix}`;
			
			const candidates = dictIndex.get(indexKey);
			if (candidates) {
				for (const phrase of candidates) {
					const phraseLen = Array.from(phrase).length;
					if (!matchedByWordCount[phraseLen]) {
						matchedByWordCount[phraseLen] = [];
					}
					// 这里仍需稍微校验一下（如果 queryLen < phraseLen 需要后缀校验，如果 queryLen == phraseLen 需要全量校验）
					// 由于索引已经按后缀分类，这里只需要简单去重
					if (!matchedByWordCount[phraseLen].includes(phrase)) {
						matchedByWordCount[phraseLen].push(phrase);
					}
				}
			}
		}
	} else if (dict) {
		// 回退到旧的慢速遍历逻辑（以防索引构建失败）
		for (const [dictKey, candidates] of Object.entries(dict)) {
			const dictVariants = buildKeyVariants(dictKey);
			const hasMatch = dictVariants.some(dk => {
				for (const qk of queryVariantSet) {
					if (dk === qk || dk.endsWith('_' + qk)) return true;
				}
				return false;
			});
			if (!hasMatch) continue;
			if (candidates && Array.isArray(candidates)) {
				for (const phrase of candidates) {
					const phraseLen = Array.from(phrase).length;
					if (!matchedByWordCount[phraseLen]) {
						matchedByWordCount[phraseLen] = [];
					}
					if (!matchedByWordCount[phraseLen].includes(phrase)) {
						matchedByWordCount[phraseLen].push(phrase);
					}
				}
			}
		}
	}
	
	// 从自定义词库内存缓存中查询
	if (customCache && customCache.length > 0) {
		for (const item of customCache) {
			const phrase = item.word;
			if (typeof phrase === 'string' && phrase.length > 0) {
				const phraseInfos = Array.from(phrase).map(ch => toInfo(ch)).filter(Boolean);
				if (phraseInfos.length > 0) {
					// 支持多级匹配：优先全词匹配，其次末尾匹配
					const phraseLen = Array.from(phrase).length;
					
					let hit = false;
					// 1. 全词匹配 (如果长度一致)
					if (phraseLen === sourceLength) {
						const phraseKey = phraseInfos.map(info => `${info.fin}${info.tone}`).join('_');
						const phraseVariants = buildKeyVariants(phraseKey);
						hit = phraseVariants.some(v => queryVariantSet.has(v));
					}
					
					// 2. 末尾匹配 (倒数两个字，兼容旧逻辑)
					if (!hit) {
						const lastTwoPhrase = phraseInfos.length >= 2 ? phraseInfos.slice(-2) : phraseInfos;
						const phraseKey = lastTwoPhrase.map(info => `${info.fin}${info.tone}`).join('_');
						const phraseVariants = buildKeyVariants(phraseKey);
						hit = phraseVariants.some(v => queryVariantSet.has(v));
					}
					
					if (hit) {
						if (!matchedByWordCount[phraseLen]) {
							matchedByWordCount[phraseLen] = [];
						}
						// 自定义词语增加特殊标记以便前端识别（可选）
						const markedPhrase = phrase; 
						if (!matchedByWordCount[phraseLen].includes(markedPhrase)) {
							// 自定义词插到最前面
							matchedByWordCount[phraseLen].unshift(markedPhrase);
						}
					}
				}
			}
		}
	}
	
	let sortedLengths = Object.keys(matchedByWordCount).map(Number).sort((a, b) => a - b);
	
	const sameLengthResults = [];
	const moreLengthResults = [];
	const lessLengthResults = [];
	
	const sameLengthCandidates = sortedLengths.filter(len => len === sourceLength);
	for (const len of sameLengthCandidates) {
		sameLengthResults.push(...matchedByWordCount[len]);
	}
	
	const targetLess = sourceLength - 1;
	if (targetLess >= 1 && matchedByWordCount[targetLess]) {
		lessLengthResults.push(...matchedByWordCount[targetLess]);
	}
	
	if (sameLengthResults.length === 0 && sourceLength > 2) {
		let currentLength = sourceLength - 1;
		while (currentLength >= 2 && sameLengthResults.length === 0) {
			const shorterInfos = infos.slice(-currentLength);
			const shorterResult = queryDict(shorterInfos, looseness);
			
			if (shorterResult && shorterResult.sameLength && shorterResult.sameLength.length > 0) {
				sameLengthResults.push(...shorterResult.sameLength);
				devLog && devLog(`降级查询成功：从 ${sourceLength} 字降到 ${currentLength} 字`);
				break;
			}
			
			currentLength--;
		}
	}
	
	const moreLengthCandidates = sortedLengths.filter(len => len > sourceLength);
	for (const len of moreLengthCandidates) {
		moreLengthResults.push(...matchedByWordCount[len]);
	}
	
	return {
		sameLength: sameLengthResults.length > 0 ? sameLengthResults : null,
		lessLength: lessLengthResults.length > 0 ? lessLengthResults : null,
		moreLengths: moreLengthResults.length > 0 ? moreLengthResults : null
	};
};

/**
 * 从韵脚库中选择匹配的字
 * @param {string} fin - 韵母
 * @param {number} originalTone - 原始声调
 * @param {number} looseness - 宽松度
 * @param {number|null} forceTone - 强制声调
 * @returns {string|null} 匹配的字
 */
const pickFromMap = (fin, originalTone, looseness, forceTone = null) => {
	const tier = getLoosenessTier(looseness);
	
	let finalsToTry;
	if (fin.includes('-')) {
		finalsToTry = [fin];
	} else {
		finalsToTry = buildFinalVariants(fin, tier);
	}

	let targetTones = [];
	if (forceTone !== null) {
		targetTones = [Number(forceTone)];
	} else {
		if (tier >= 2) {
			targetTones = [1, 2, 3, 4];
		} else {
			targetTones = [originalTone];
		}
	}

	const candidates = [];
	for (const f of finalsToTry) {
		for (const t of targetTones) {
			candidates.push(...(bankMap.get(`${f}-${t}`) || []));
		}
	}

	if (candidates.length === 0) return null;
	return candidates[Math.floor(Math.random() * candidates.length)];
};

/**
 * 加载在线词库
 * @returns {Promise<void>}
 */
const loadOnlineDict = async () => {
	const btn = document.getElementById('loadDictBtn');
	const originalText = btn.textContent;
	btn.innerHTML = '<i class="ri-loader-4-line"></i> 加载中...';
	btn.disabled = true;

	if (typeof Worker === 'undefined') {
		console.warn('Web Worker not supported, using fallback method');
		await loadOnlineDictFallback();
		return;
	}

	try {
		let progressBar = document.getElementById('dictProgressBar');
		if (!progressBar) {
			progressBar = document.createElement('div');
			progressBar.id = 'dictProgressBar';
			document.body.insertBefore(progressBar, document.body.firstChild);
		}
		progressBar.style.display = 'block';

		const worker = new Worker('./dict-worker.js');

		const dictSources = [
			{
				name: '本地优化词库',
				url: './dict_optimized.json'
			}
		];

		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				worker.terminate();
				reject(new Error('词库加载超时，请检查网络连接'));
			}, 120000);

			worker.onmessage = (event) => {
				const { type, message, data, progress, percent } = event.data;

				if (type === 'progress' || type === 'parsing') {
					btn.textContent = message || `加载中... ${percent || progress}%`;
					if (percent) {
						progressBar.style.width = percent + '%';
					}
				}

				if (type === 'success') {
					clearTimeout(timeout);
					worker.terminate();

					const { chars, sourceName, stats } = data;
					try {
						localStorage.setItem('ONLINE_DICT_CACHE', JSON.stringify(chars));
						localStorage.setItem('ONLINE_DICT_TIME', Date.now().toString());
						localStorage.setItem('ONLINE_DICT_SOURCE', sourceName);
						if (stats) {
							localStorage.setItem('ONLINE_DICT_STATS', JSON.stringify(stats));
						}

						if (window.refreshRhymeBank) window.refreshRhymeBank();
						bankMap = registerBank();

						btn.textContent = `✓ 已加载 ${chars.length} 字`;
						btn.style.background = 'rgba(34, 211, 238, 0.2)';
						progressBar.style.width = '100%';

						const dictStatus = document.getElementById('dictStatus');
						const dictStatusText = document.getElementById('dictStatusText');
						const date = new Date();
						dictStatus.style.display = 'block';
						
						let statusText = `📖 词库：${chars.length} 个唯一汉字（${sourceName}）`;
						if (stats && stats.totalChars) {
							statusText += ` | 数据统计：${stats.categories.toLocaleString()} 分类，${stats.totalStrings.toLocaleString()} 条目，${stats.totalChars.toLocaleString()} 字符（去重前）`;
						}
						statusText += ` | ${date.toLocaleString('zh-CN')}`;
						dictStatusText.textContent = statusText;

						setTimeout(() => {
							btn.innerHTML = `<i class="ri-book-2-line"></i> 已缓存 ${chars.length} 字`;
							btn.style.background = '';
							progressBar.style.display = 'none';
						}, 1500);

						resolve();
					} catch (err) {
						reject(err);
					}
				}

				if (type === 'error') {
					clearTimeout(timeout);
					worker.terminate();
					reject(new Error(message));
				}
			};

			worker.onerror = (err) => {
				clearTimeout(timeout);
				worker.terminate();
				reject(err);
			};

			worker.postMessage({
				action: 'loadAndProcess',
				payload: { dictSources }
			});
		});
	} catch (err) {
		console.error('词库加载失败:', err);
		btn.textContent = `✗ ${err.message || '加载失败'}`;
		btn.style.background = 'rgba(239, 68, 68, 0.2)';
		const progressBar = document.getElementById('dictProgressBar');
		if (progressBar) progressBar.style.display = 'none';

		setTimeout(() => {
			btn.textContent = originalText;
			btn.disabled = false;
			btn.style.background = '';
		}, 3000);
	}
};

/**
 * 加载在线词库（回退方案）
 * @returns {Promise<void>}
 */
const loadOnlineDictFallback = async () => {
	const btn = document.getElementById('loadDictBtn');
	const originalText = btn.textContent;

	try {
		const response = await fetch('./dict_optimized.json', {
			method: 'GET',
			headers: { 'Accept': 'application/json' }
		});

		if (!response.ok) throw new Error('HTTP ' + response.status);

		btn.innerHTML = '<i class="ri-loader-4-line"></i> 解析中...';
		const data = await response.json();
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
				if (idx % 5000 === 0) {
					btn.innerHTML = `<i class="ri-loader-4-line"></i> 解析中... ${Math.round((idx / data.length) * 100)}%`;
				}
				if (typeof item === 'string') {
					stats.totalStrings++;
					Array.from(item).forEach(ch => {
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
			entries.forEach(([, value], idx) => {
				if (idx % 500 === 0) {
					btn.innerHTML = `<i class="ri-loader-4-line"></i> 解析中... ${Math.round((idx / entries.length) * 100)}%`;
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

		const charArray = Array.from(chars);
		stats.uniqueChars = charArray.length;
		
		localStorage.setItem('ONLINE_DICT_CACHE', JSON.stringify(charArray));
		localStorage.setItem('ONLINE_DICT_TIME', Date.now().toString());
		localStorage.setItem('ONLINE_DICT_SOURCE', '本地优化词库');
		localStorage.setItem('ONLINE_DICT_STATS', JSON.stringify(stats));

		if (window.refreshRhymeBank) window.refreshRhymeBank();
		bankMap = registerBank();

		btn.textContent = `✓ 已加载 ${charArray.length} 字`;
		btn.style.background = 'rgba(34, 211, 238, 0.2)';

		const dictStatus = document.getElementById('dictStatus');
		const dictStatusText = document.getElementById('dictStatusText');
		dictStatus.style.display = 'block';
		
		let statusText = `<i class="ri-book-open-line"></i> 词库：${charArray.length} 个唯一汉字（本地优化词库）`;
		if (stats.totalChars > 0) {
			statusText += ` | 数据统计：${stats.categories.toLocaleString()} 分类，${stats.totalStrings.toLocaleString()} 条目，${stats.totalChars.toLocaleString()} 字符（去重前）`;
		}
		statusText += ` | ${new Date().toLocaleString('zh-CN')}`;
		dictStatusText.textContent = statusText;

		setTimeout(() => {
			btn.innerHTML = `✅️ 已缓存 ${charArray.length} 字`;
			btn.disabled = false;
			btn.style.background = '';
		}, 1500);
	} catch (err) {
		console.error('词库加载失败:', err);
		btn.textContent = '✗ 加载失败';
		btn.style.background = 'rgba(239, 68, 68, 0.2)';

		setTimeout(() => {
			btn.textContent = originalText;
			btn.disabled = false;
			btn.style.background = '';
		}, 3000);
	}
};

/**
 * 更新词库状态显示
 */
const updateDictStatus = () => {
	const cachedTime = localStorage.getItem('ONLINE_DICT_TIME');
	const dictStatus = document.getElementById('dictStatus');
	const dictStatusText = document.getElementById('dictStatusText');
	const loadDictBtn = document.getElementById('loadDictBtn');
	
	if (cachedTime) {
		const cached = localStorage.getItem('ONLINE_DICT_CACHE');
		if (cached) {
			try {
				const chars = JSON.parse(cached);
				const date = new Date(Number(cachedTime));
				const source = localStorage.getItem('ONLINE_DICT_SOURCE') || '在线词库';
				loadDictBtn.innerHTML = `✅️ 已缓存 ${chars.length} 字`;
				loadDictBtn.title = '点击重新加载词库';
				
				dictStatus.style.display = 'block';
				
				let statusText = `📖 词库：${chars.length} 个唯一汉字（${source}）`;
				try {
					const statsStr = localStorage.getItem('ONLINE_DICT_STATS');
					if (statsStr) {
						const stats = JSON.parse(statsStr);
						if (stats.totalChars > 0) {
							statusText += ` | 数据统计：${stats.categories.toLocaleString()} 分类，${stats.totalStrings.toLocaleString()} 条目，${stats.totalChars.toLocaleString()} 字符（去重前）`;
						}
					}
				} catch (e) {}
				
				statusText += ` | ${date.toLocaleString('zh-CN')}`;
				dictStatusText.textContent = statusText;
			} catch (e) {}
		}
	}
};

// 导出模块
window.DictManager = {
	dict,
	bankMap,
	loadDict,
	registerBank,
	queryDict,
	pickFromMap,
	loadOnlineDict,
	loadOnlineDictFallback,
	updateDictStatus,
	preloadCustomBank,
	setBankMap: (map) => { bankMap = map; },
	getBankMap: () => bankMap,
	getDict: () => dict
};
})();
