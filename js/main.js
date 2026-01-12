const cdnList = [
			'https://unpkg.com/pinyin-pro@3.27.0/dist/index.js',
			'https://cdn.jsdelivr.net/npm/pinyin-pro@3.27.0/dist/index.js',
			// 如果需要本地备用，将 pinyin-pro.umd.js 放在同目录并取消下一行注释
			// './pinyin-pro.umd.js'
		];

		const loadScriptSeq = (list, cb) => {
			if (!list.length) return cb(new Error('全部 CDN 加载失败'));
			const [url, ...rest] = list;
			const s = document.createElement('script');
			s.src = url;
			s.onload = () => cb(null, url);
			s.onerror = () => {
				s.remove();
				loadScriptSeq(rest, cb);
			};
			document.head.appendChild(s);
		};

		const setOutputStatus = (msg) => {
			// Output element removed
		};
		const finals = [
			'iong', 'uang', 'iang', 'ueng', 'uan', 'ian', 'uen', 'iao', 'uai', 'ang', 'eng', 'ing', 'ong', 'ai', 'ei', 'ao', 'ou', 'an', 'en', 'in', 'un', 'vn', 'ia', 'ua', 'uo', 'ie', 'ue', 'ui', 'er', 'a', 'o', 'e', 'i', 'u', 'v'
		];

		let bankMap = new Map();
		let pinyinReady = false;
		let currentInfos = [];
		let currentDictResult = null; // 存储字典查询结果
		let dict = null; // 优化字典
		let suffixIndex = new Map(); // 新增：后缀索引，用于支持更长词匹配
		let locks = [];

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

		async function getAllKeysFromDB() {
			const db = await openDB();
			return new Promise((resolve, reject) => {
				const transaction = db.transaction([STORE_NAME], 'readonly');
				const store = transaction.objectStore(STORE_NAME);
				const request = store.getAllKeys();
				request.onsuccess = (e) => resolve(e.target.result);
				request.onerror = (e) => reject(e.target.error);
			});
		}

		// 平仄过滤函数：根据尾字声调过滤词语列表
		// pingze: 'all' | 'ping' | 'ze'
		// 平声 = 1, 2声调；仄声 = 3, 4声调
		const filterByPingZe = (phrases, pingze) => {
			if (!pingze || pingze === 'all' || !Array.isArray(phrases)) {
				return phrases;
			}
			
			return phrases.filter(phrase => {
				if (!phrase || phrase.length === 0) return false;
				
				// 获取尾字
				const chars = Array.from(phrase);
				const lastChar = chars[chars.length - 1];
				const lastInfo = toInfo(lastChar);
				
				if (!lastInfo || !lastInfo.tone || lastInfo.tone === '-') {
					return false; // 无法确定声调的词语排除
				}
				
				const tone = Number(lastInfo.tone);
				
				if (pingze === 'ping') {
					// 平声：1、2声
					return tone === 1 || tone === 2;
				} else if (pingze === 'ze') {
					// 仄声：3、4声
					return tone === 3 || tone === 4;
				}
				
				return true;
			});
		};

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

		// Bloom Filter implementation
		class BloomFilter {
			constructor(size = 10000, hashCount = 3) {
				this.size = size;
				this.hashCount = hashCount;
				this.bitArray = new Uint8Array(Math.ceil(size / 8));
			}

			_hash(string, seed) {
				let hash = 0;
				for (let i = 0; i < string.length; i++) {
					hash = (hash * 31 + string.charCodeAt(i) + seed) % this.size;
				}
				return hash;
			}

			add(string) {
				for (let i = 0; i < this.hashCount; i++) {
					const index = this._hash(string, i);
					this.bitArray[index >> 3] |= (1 << (index & 7));
				}
			}

			mightContain(string) {
				for (let i = 0; i < this.hashCount; i++) {
					const index = this._hash(string, i);
					if (!(this.bitArray[index >> 3] & (1 << (index & 7)))) {
						return false;
					}
				}
				return true;
			}
		}

		let bloomFilter = new BloomFilter();

		// 全局词库对象，用于快速内存查询
		let globalDictData = null;

		// 加载优化字典（拆分为3个文件）
		const loadDict = async () => {
			if (window.isDictLoading) return;
			window.isDictLoading = true;

			try {
				// 极致优化：不再写入 IndexedDB（写入太慢），直接将整个 JSON 载入内存
				// 拆分成3个文件以提升加载性能
				devLog('开始极速载入词库（3个文件）...');
				const startTime = performance.now();
				
				// 并行加载3个拆分文件
				const [response1, response2, response3] = await Promise.all([
					fetch('./dict_part_1.json'),
					fetch('./dict_part_2.json'),
					fetch('./dict_part_3.json')
				]);
				
				if (!response1.ok || !response2.ok || !response3.ok) {
					throw new Error('加载词典文件失败');
				}
				
				// 并行解析JSON
				const [data1, data2, data3] = await Promise.all([
					response1.json(),
					response2.json(),
					response3.json()
				]);
				
				// 合并3个数据对象
				const data = {...data1, ...data2, ...data3};
				
				// 预处理 Key
				globalDictData = new Map();
				suffixIndex = new Map(); // 重置后缀索引
				
				for (const key in data) {
					const encoded = encodeKey(key);
					globalDictData.set(encoded, data[key]);
					
					// 修改索引逻辑：使用末尾 1 个编码字符作为索引键（通常是韵母编码+声调，共2位）
					// e.g. "废壳" -> "ei4_e2" -> encodeKey -> "e4v2"
					// 末尾字是 "v2"，长度为 2
					if (encoded.length >= 2) {
						const suffix = encoded.slice(-2);
						if (!suffixIndex.has(suffix)) suffixIndex.set(suffix, []);
						suffixIndex.get(suffix).push(encoded);
					}
				}
				
				// --- 核心修复：重建索引供长词匹配查询使用 ---
				const keys = Array.from(globalDictData.keys());
				bloomFilter = new BloomFilter(keys.length * 10, 3);
				keys.forEach(k => bloomFilter.add(k));
				// ------------------------------------------

				window.dictLoaded = true;
				window.isDictLoading = false;
				devLog('词库全量载入内存耗时:', (performance.now() - startTime).toFixed(2), 'ms');
				
				// 更新 UI
				const btn = document.getElementById('loadDictBtn');
				if (btn) btn.innerHTML = `✅ 已就绪 (${globalDictData.size} 组)`;
				
				const warning = document.getElementById('dictWarning');
				if (warning) warning.style.display = 'none';

			} catch (e) {
				console.error('极速载入失败:', e);
				window.isDictLoading = false;
			}
		};

		// 极速获取数据函数
		async function getFromDB(key) {
			// 优先从内存 Map 中获取，这是毫秒级的
			if (globalDictData && globalDictData.has(key)) {
				return globalDictData.get(key);
			}
			return null;
		}

	const normalize = (p) => p.replace(/\d/g, '').replace(/ü/g, 'v').replace(/u:/g, 'v');

	// 将键统一转成 v 形式，并生成 v/u 双版本，兼容词典中可能用 u 表示 ü 的情况
	const buildKeyVariants = (key) => {
		const base = String(key).replace(/ü/g, 'v').replace(/u:/g, 'v');
			const variants = new Set([base, base.replace(/v/g, 'u')]);
			return Array.from(variants);
		};

		const extractTone = (p) => {
			const m = p.match(/(\d)/);
			return m ? Number(m[1]) : 0;
		};

		const detectFinal = (p) => {
			// 标准化：ü -> v
			let normalizedP = p.replace(/ü/g, 'v').replace(/u:/g, 'v');
			
			// 提取声母（按长度排序，确保 zh 优先于 z）
			const initials = ['zh', 'ch', 'sh', 'z', 'c', 's', 'b', 'p', 'm', 'f', 'd', 't', 'n', 'l', 'g', 'k', 'h', 'j', 'q', 'x', 'r', 'w', 'y'];
			let initial = '';
			for (const init of initials) {
				if (normalizedP.startsWith(init)) {
					initial = init;
					break;
				}
			}
			
			let rest = normalizedP.slice(initial.length);
			
			// 特殊处理：j/q/x/y 后的 u 实际是 ü (v)
			if (['j', 'q', 'x', 'y'].includes(initial) && rest.startsWith('u')) {
				rest = 'v' + rest.slice(1);
			}
			
			// 特殊处理：j/q/x/y 后的 e 实际是 ie（比如 ye -> ie, jie -> ie）
			if (['j', 'q', 'x', 'y'].includes(initial) && rest === 'e') {
				rest = 'ie';
			}

			// 特殊处理：y 后的 an 实际是 ian (yan -> ian)
			if (initial === 'y' && rest === 'an') {
				rest = 'ian';
			}

			// --- 新增：i韵隔离协议 (Triple-I Isolation) ---
			if (rest === 'i') {
				if (['z', 'c', 's'].includes(initial)) {
					return { initial, final: 'i-flat' }; // 平舌音
				} else if (['zh', 'ch', 'sh', 'r'].includes(initial)) {
					return { initial, final: 'i-retro' }; // 翘舌音
				}
				// 其他声母（b, p, m, d, t, n, l, j, q, x, y）保持为 'i'
			}
			// -------------------------------------------
			
			// 如果没有韵母（比如 m, n, ng 自成音节），返回原拼音作为韵母
			if (!rest) return { initial, final: normalizedP };
			
			return { initial, final: rest };
		};

		const toInfo = (char) => {
			const raw = window.pinyinPro.pinyin(char, {
				type: 'array',
				toneType: 'num',
				pattern: 'pinyin'
			})[0];

			if (!raw || /[a-z]/i.test(raw) === false) return null;

			const clean = normalize(raw);
			const tone = extractTone(raw);
			const parts = detectFinal(clean);
			return parts ? { char, raw, clean, tone, fin: parts.final, ini: parts.initial } : null;
		};

		const registerBank = () => {
			if (!window.pinyinPro || !window.pinyinPro.pinyin) return new Map();
			const source = typeof window.getRhymeBank === 'function' ? window.getRhymeBank() : window.RHYME_CHAR_BANK || [];
			const map = new Map();
			for (const item of source) {
				// 将多字词拆成单个字符
				const chars = Array.from(item);
				for (const ch of chars) {
					const info = toInfo(ch);
					if (!info) continue;
					const key = `${info.fin}-${info.tone}`;
					if (!map.has(key)) map.set(key, []);
					// 避免重复添加相同的字
					if (!map.get(key).includes(ch)) {
						map.get(key).push(ch);
					}
				}
			}
			return map;
		};

		const thirteenTracks = [
			{ name: '发花辙', finals: ['a', 'ia', 'ua'] },
			{ name: '梭波辙', finals: ['o', 'e', 'uo'] },
			{ name: '乜斜辙', finals: ['ie', 'ue', 've'] },
			{ name: '言前辙', finals: ['an', 'ian', 'uan', 'van', 'üan'] },
			{ name: '人辰辙-深', finals: ['en', 'un'] },
			{ name: '人辰辙-亲', finals: ['in', 'vn', 'ün'] },
			{ name: '江阳辙', finals: ['ang', 'iang', 'uang'] },
			{ name: '中东辙', finals: ['eng', 'ing', 'ong', 'iong'] },
			{ name: '一七辙', finals: ['i', 'v', 'er', 'ü', 'i-flat', 'i-retro'] },
			{ name: '姑苏辙', finals: ['u'] },
			{ name: '怀来辙', finals: ['ai', 'uai'] },
			{ name: '灰堆辙', finals: ['ei', 'ui', 'uei'] },
			{ name: '遥条辙', finals: ['ao', 'iao'] },
			{ name: '油求辙', finals: ['ou', 'iu', 'iou'] }
		];

		const coreRhymes = ['a', 'o', 'e', 'i', 'u', 'v', 'ai', 'ei', 'ao', 'ou', 'an', 'en', 'ang', 'eng', 'ong'];

		const finalToChunk = (fin) => {
			// 根据韵母的第一个字符或核心部分进行分片
			for (let i = 0; i < thirteenTracks.length; i++) {
				if (thirteenTracks[i].finals.includes(fin)) return `chunk_${i}`;
			}
			return 'chunk_other';
		};

		// 松紧分级：
		// 0（严格）：同韵同调（区分平翘舌、前后鼻音）
		// 1（中等）：同调，但韵母放宽（不分平翘舌，不分前后鼻音）
		// 2（最松）：韵母放宽（同上），且不限制声调
		const getLoosenessTier = (value) => {
			if (value >= 0.67) return 2;
			if (value >= 0.34) return 1;
			return 0;
		};

		// 兼容旧字典键值的扩展映射
		const legacyKeyMap = {
			'i-flat': ['i'],
			'i-retro': ['i'],
			'i': [
				'i', 
				'z-retroflex', 'c-retroflex', 's-retroflex',
				'zh-retroflex-e', 'ch-retroflex-e', 'sh-retroflex-e', 'r-retroflex-e',
				'j-palatal', 'q-palatal', 'x-palatal'
			],
			'u': [
				'u',
				// 旧代码把 zu, cu, su 也归为 retroflex，所以也要查这些
				'z-retroflex', 'c-retroflex', 's-retroflex',
				'zh-retroflex-e', 'ch-retroflex-e', 'sh-retroflex-e', 'r-retroflex-e'
			]
		};

		// 从字典查询拼音组合对应的词组（新算法）
		// 使用最后两个字的韵脚为查询条件，返回所有相关匹配
		const queryDict = async (infos, looseness) => {
			if (!infos || infos.length === 0) return null;
			
			// 1. 核心极速逻辑：如果 Bloom Filter 还没准备好，尝试触发懒加载
			if (!window.dictLoaded && !window.isDictLoading) {
				console.log('触发词库自动挂载...');
				loadDict();
			}

			// 修改：不再强制只取最后两个字，而是根据输入长度决定
			// 用户要求：查询条件跟生成结果一样，字数由用户输入决定
			let queryInfos = infos;
			
			// 验证韵脚信息的有效性
			const validInfos = queryInfos.filter(info => info.fin && info.fin !== '-');
			if (validInfos.length === 0) return null;
			
			const tier = getLoosenessTier(looseness);
			const allowToneRelax = tier >= 2;
			
			// 生成所有可能的查询键变体
			const generateQueryKeys = (infos) => {
				const keys = [];
				const recurse = (index, current) => {
					if (index === infos.length) {
						keys.push(current.join('_'));
						return;
					}
					const info = infos[index];
					// Tier 2: 所有字都允许声调放宽（因为只处理最后两个字，组合数可控）
					// Tier 0/1: 必须严格匹配声调
					const toneVariants = allowToneRelax ? [1,2,3,4] : [info.tone];
					
					// 获取该韵母的所有变体
					const finVariants = buildFinalVariants(info.fin, tier);
					
					// 扩展为旧字典的键值
					const expandedVariants = new Set();
					for (const v of finVariants) {
						expandedVariants.add(v);
						if (legacyKeyMap[v]) {
							legacyKeyMap[v].forEach(k => expandedVariants.add(k));
						}
					}

					for (const fin of expandedVariants) {
						for (const tone of toneVariants) {
							const keyPart = `${fin}${tone}`;
							recurse(index + 1, [...current, keyPart]);
						}
					}
				};
				recurse(0, []);
				return keys;
			};
			
			const queryKeys = generateQueryKeys(validInfos);
			const queryVariantSet = new Set();
			queryKeys.forEach(k => {
				buildKeyVariants(k).forEach(v => {
					const encoded = encodeKey(v);
					// 内存模式下直接信任内存数据，不使用 Bloom Filter 过滤以防漏掉结果
					queryVariantSet.add(encoded);
				});
			});
			
			// 在字典中搜索所有可能的匹配
			const matchedByWordCount = {};
			const sourceLength = infos.length;
			
			// 优化方案：移动端优先，只使用精准哈希查询
			for (const qk of queryVariantSet) {
			// 1. 精确匹配（相同长度）
			const candidates = await getFromDB(qk);
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

				// 2. 后缀匹配（更长的词）
				// 使用末尾一个字（长度2）进行初步索引筛选，提高效率
				if (qk.length >= 2) {
					const suffix = qk.slice(-2);
					const longerKeys = suffixIndex.get(suffix) || [];
					for (const lk of longerKeys) {
						// 严格匹配整个 qk 作为后缀，且长度更长
						if (lk.endsWith(qk) && lk.length > qk.length) {
							const moreCandidates = await getFromDB(lk);
							if (moreCandidates && Array.isArray(moreCandidates)) {
								for (const phrase of moreCandidates) {
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
				}
			}

			// 如果内存中查不到，且此时词库还没加载，自动触发一次极速加载
			if (Object.keys(matchedByWordCount).length === 0 && !window.dictLoaded) {
				loadDict();
			}
			
			// 也从自定义词库中查询
			try {
				const customStr = localStorage.getItem('CUSTOM_RHYME_BANK');
				if (customStr) {
					const customBank = JSON.parse(customStr);
					if (Array.isArray(customBank)) {
						for (const phrase of customBank) {
							if (typeof phrase === 'string' && phrase.length > 0) {
								// 检查自定义词是否符合查询条件
								// 根据当前查询 infos 的长度，决定匹配长度
								const phraseInfos = Array.from(phrase).map(ch => toInfo(ch)).filter(Boolean);
								if (phraseInfos.length > 0) {
									// 匹配逻辑：如果自定义词比查询词长，取其末尾相同长度的部分进行匹配
									// 如果自定义词比查询词短，则它必须完全符合查询词末尾的部分
									const matchLen = Math.min(phraseInfos.length, infos.length);
									const relevantPhraseInfos = phraseInfos.slice(-matchLen);
									
									// 构造用于匹配的 key
									const phraseKeyParts = relevantPhraseInfos.map(info => `${info.fin}${info.tone}`);
									const phraseKey = phraseKeyParts.join('_');
									
									// 生成查询条件在该长度下的 key 集合
									const targetInfos = infos.slice(-matchLen);
									const targetQueryKeys = generateQueryKeys(targetInfos);
									const targetVariantSet = new Set();
									targetQueryKeys.forEach(k => {
										buildKeyVariants(k).forEach(v => {
											targetVariantSet.add(encodeKey(v));
										});
									});

									const encodedPhraseKey = encodeKey(phraseKey);
									if (targetVariantSet.has(encodedPhraseKey)) {
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
					}
				}
			} catch (e) {
				console.warn('自定义词库读取失败:', e);
			}
			
		// 返回分类结果
		let sortedLengths = Object.keys(matchedByWordCount).map(Number).sort((a, b) => a - b);
		
		const sameLengthResults = [];
		const moreLengthResults = [];
		const lessLengthResults = [];
		
		// 先添加相同字数的匹配
		const sameLengthCandidates = sortedLengths.filter(len => len === sourceLength);
		for (const len of sameLengthCandidates) {
			sameLengthResults.push(...matchedByWordCount[len]);
		}
		
		// 收集少一字的匹配
		const targetLess = sourceLength - 1;
		if (targetLess >= 1 && matchedByWordCount[targetLess]) {
			lessLengthResults.push(...matchedByWordCount[targetLess]);
		}
		
		// 如果没有相同字数的匹配，且源字数大于2，尝试降级查询
		if (sameLengthResults.length === 0 && sourceLength > 2) {
			let currentLength = sourceLength - 1;
			while (currentLength >= 2 && sameLengthResults.length === 0) {
				// 取末尾 currentLength 个字重新查询
				const shorterInfos = infos.slice(-currentLength);
				const shorterResult = await queryDict(shorterInfos, looseness);
				
				if (shorterResult && shorterResult.sameLength && shorterResult.sameLength.length > 0) {
					sameLengthResults.push(...shorterResult.sameLength);
					devLog(`降级查询成功：从 ${sourceLength} 字降到 ${currentLength} 字`);
					break;
				}
				
				currentLength--;
			}
		}
		
		// 然后添加所有字数更多的匹配
		const moreLengthCandidates = sortedLengths.filter(len => len > sourceLength);
		for (const len of moreLengthCandidates) {
			moreLengthResults.push(...matchedByWordCount[len]);
		}
		
		return {
			sameLength: sameLengthResults.length > 0 ? sameLengthResults : [],
			lessLength: lessLengthResults.length > 0 ? lessLengthResults : [],
			moreLengths: moreLengthResults.length > 0 ? moreLengthResults : []
		};
	};

		const buildFinalVariants = (fin, tier) => {
			// Tier 0: 严格模式，完全匹配
			if (tier === 0) return [fin];

			// Tier 1 & 2: 宽松模式 (合并平翘舌，合并前后鼻音)
			
			// 1. 前后鼻音合并：言前(an) + 江阳(ang)
			const groupAnAng = ['an', 'ian', 'uan', 'van', 'üan', 'ang', 'iang', 'uang'];
			if (groupAnAng.includes(fin)) return groupAnAng;

			// 2. 前后鼻音合并：
			// 人辰-深(en/un) + 中东-eng(eng/ong) -> 实际上 en 和 eng 押韵更近
			const groupEnEng = ['en', 'un', 'eng', 'ong', 'iong'];
			if (groupEnEng.includes(fin)) return groupEnEng;

			// 人辰-亲(in/vn/ün) + 中东-ing(ing) -> 实际上 in 和 ing 押韵更近
			const groupInIng = ['in', 'vn', 'ün', 'ing'];
			if (groupInIng.includes(fin)) return groupInIng;

			// 3. 其他情况（包括 i-flat/i-retro 归为一七辙），使用十三辙
			const track = thirteenTracks.find(t => t.finals.includes(fin));
			return track ? track.finals : [fin];
		};

		const normalizeSpecialFinal = (fin) => {
			// 旧逻辑残留，现在直接返回 fin 即可
			return fin;
		};

		// 检查候选短语是否逐字匹配源词的韵脚（优先保证每个字的韵脚一致）
		const phraseFitsSource = (phrase, sourceInfos, looseness) => {
			const tier = getLoosenessTier(looseness);
			const allowToneRelax = tier >= 2; // Tier 2 忽略声调
			const chars = Array.from(phrase);
			
			// 修改：始终从末尾对齐进行比较
			// 无论是长词还是短词，都比较末尾对应的字
			const len = Math.min(chars.length, sourceInfos.length);
			const srcOffset = sourceInfos.length - len;
			const phraseOffset = chars.length - len;

			// 定义特殊声母集合（平翘舌）
			const specialInitials = ['zh', 'ch', 'sh', 'r', 'z', 'c', 's'];

			for (let i = 0; i < len; i++) {
				const src = sourceInfos[srcOffset + i];
				const ch = chars[phraseOffset + i];
				const pInfo = ch ? toInfo(ch) : null;
				if (!src || !pInfo || !src.fin || src.fin === '-') return false;
				
				// 检查韵母兼容性
				let rhymeOk = false;
				if (tier === 0) {
					// 严格：必须完全相同
					rhymeOk = (src.fin === pInfo.fin);
				} else {
					// 宽松：检查是否在同一个变体组中
					const variants = buildFinalVariants(src.fin, tier);
					rhymeOk = variants.includes(pInfo.fin);
				}
				
				if (!rhymeOk) return false;
				
				// 检查声调
				// Tier 0 & 1: 声调必须相同
				// Tier 2: 声调可不同
				const toneOk = allowToneRelax || (src.tone === pInfo.tone);
				if (!toneOk) return false;

				// --- 新增：声母类型过滤 ---
				// 规则：如果源字声母不是平翘舌音，则匹配字声母也不能是平翘舌音。
				// 避免“自律(l)”匹配到“世世(sh)”这种听感差异巨大的情况。
				const srcIsSpecial = specialInitials.includes(src.ini);
				const matchIsSpecial = specialInitials.includes(pInfo.ini);
				
				if (!srcIsSpecial && matchIsSpecial) {
					return false;
				}
				// -------------------------
			}
			return true;
		};

		const pickFromMap = (fin, originalTone, looseness, forceTone = null) => {
			const tier = getLoosenessTier(looseness);
			
			// 对于特殊标记的韵母，不进行扩展
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
				// Tier 2: 所有声调
				// Tier 0/1: 严格声调
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

			// 如果最松档且没有结果，才尝试忽略声调
			if (candidates.length === 0 && tier >= 2 && !forceTone) {
				// 已经在上面处理了所有声调，这里不需要额外逻辑，除非 bankMap 缺失
			}

			if (candidates.length === 0) return null;
			return candidates[Math.floor(Math.random() * candidates.length)];
		};

		const processAI = async (src, infos, looseness) => {
			const apiKey = localStorage.getItem('GEMINI_API_KEY');
			const proxy = localStorage.getItem('GEMINI_PROXY') || '';
			if (!apiKey) {
				alert('请先输入 Gemini API Key');
				return;
			}

			const output = document.getElementById('output');
			const badges = document.getElementById('badges');
			const matchedResultsList = document.getElementById('matchedResultsList');
			
			output.innerHTML = '<i class="ri-robot-2-line"></i> AI 正在思考中...';
			badges.innerHTML = '<div class="badge"><i class="ri-time-line"></i> 请稍候</div>';
			matchedResultsList.innerHTML = '';

			const tier = getLoosenessTier(looseness);
			const rhymeInfo = infos.map(i => `${i.char}(${i.fin}${i.tone})`).join(' ');
			
			const prompt = `你是一个深谙中文韵律的顶级作词人，现在需要根据一个词寻找押韵的词汇。

					【输入词】：${src}
					【韵部】：${rhymeInfo}
					【等级】：Tier ${tier}（0为死押、音调和韵脚要一致，1为通押、优先音调一致，2为谐音、音调可以不一致）

						任务：
						1. 生成至少 25 个与输入词语押韵的中文词语。
						2. 生成的词语不能和输入词语相同。生成的词语要包含不限于常用词语、网络词语、成语、歌词等，但优先显示生成的歌词和常见词语。
						3. 生成字数相同的词语25个,但也要生成15个包含字数更多尾部押韵的词语。生成更多字数的押韵词语要尽量多样化，尾部不可以重复。
						4. 必须严格遵守韵脚和音调要求（除非等级Tier较高，音调为1,2,3,4）。
						5. 只返回词语列表，用空格分隔，不要有任何解释。
						6. 严禁生拼硬凑，绝对禁止生成“死词”（如：XX机、XX门等无意义组合）。`;

			try {
				let baseUrl = 'https://generativelanguage.googleapis.com';
				if (proxy) {
					baseUrl = proxy.replace(/\/$/, '');
				}

				const response = await fetch(`${baseUrl}/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						contents: [{ parts: [{ text: prompt }] }]
					})
				});

				if (!response.ok) {
					const errorData = await response.json().catch(() => ({}));
					throw new Error(errorData.error?.message || `HTTP ${response.status}`);
				}

				const data = await response.json();
				const text = data.candidates[0].content.parts[0].text.trim();
				// 使用正则提取所有中文字符串，过滤掉非中文和原词
				const aiWords = (text.match(/[\u4e00-\u9fa5]+/g) || []).filter(w => w && w !== src);

				if (aiWords.length === 0) {
					throw new Error('AI 未返回有效的押韵词，请重试。');
				}

				// 将 AI 结果分类，模拟 dictResult 结构
				const sourceLength = Array.from(src).length;
				const dictResult = {
					sameLength: aiWords.filter(w => Array.from(w).length === sourceLength),
					lessLength: aiWords.filter(w => Array.from(w).length < sourceLength),
					moreLengths: aiWords.filter(w => Array.from(w).length > sourceLength)
				};

				// 构造 infos 结构，用于渲染表格
				const firstAiWord = dictResult.sameLength[0] || aiWords[0] || src;
				const aiChars = Array.from(firstAiWord);
				const newInfos = infos.map((info, idx) => {
					const char = aiChars[idx] || info.char;
					return {
						...info,
						generated: char,
						candidates: aiWords.filter(w => Array.from(w).length === sourceLength).map(w => Array.from(w)[idx]).filter(Boolean),
						locked: false
					};
				});

				currentInfos = newInfos;
				currentDictResult = dictResult;
				render(newInfos, firstAiWord, dictResult, src, true);

			} catch (e) {
				console.error('AI 生成失败:', e);
				let errorMsg = e.message;
				if (errorMsg === 'Failed to fetch') {
					errorMsg = '网络连接失败 (Failed to fetch)。如果你在特殊网络环境下，请尝试在设置中配置 API 代理地址。';
				}
				output.textContent = '❌ AI 生成失败: ' + errorMsg;
				badges.innerHTML = '';
			} finally {
				// Remove loading state
				const goBtn = document.getElementById('go');
				setTimeout(() => {
					goBtn.classList.remove('loading');
				}, 100);
			}
		};

		const process = async () => {
		const goBtn = document.getElementById('go');
		const src = document.getElementById('source').value.trim();
		const looseness = Number(document.getElementById('looseness').value);
		const isAiMode = document.getElementById('aiMode').checked;
		const pingzeFilter = document.querySelector('input[name="pingze"]:checked')?.value || 'all';
		
		// Show loading state
		goBtn.classList.add('loading');
		if (!goBtn.querySelector('.btn-text')) {
			goBtn.innerHTML = '<span class="btn-text">' + goBtn.textContent + '</span>';
		}
		
		if (!pinyinReady || !window.pinyinPro || !window.pinyinPro.pinyin) {
			goBtn.classList.remove('loading');
			render([], 'pinyin-pro 未加载，请检查网络或稍后重试', null, '');
			return;
		}
		if (bankMap.size === 0) bankMap = registerBank();
		if (!src) {
			goBtn.classList.remove('loading');
			render([], '等待输入...', null, '');
			return;
		}

		// Build new infos but preserve locked/forced settings from previous run
			const oldInfos = Array.isArray(currentInfos) ? currentInfos.slice() : [];
			
			// 先提取所有字符的拼音信息，记录基准声调
			const tempInfos = Array.from(src).map((ch) => {
				const info = toInfo(ch);
				if (!info) return { char: ch, raw: '-', tone: '-', baseTone: '-', fin: '-', forcedTone: null };
				return { ...info, baseTone: info.tone, forcedTone: null };
			});

			// 应用用户在解析表中选择的强制声调
			const tempInfosWithOverrides = tempInfos.map((info, idx) => {
				const old = oldInfos[idx];
				const forcedTone = old && old.forcedTone !== null ? old.forcedTone : null;
				const tone = forcedTone !== null ? forcedTone : info.baseTone;
				return { ...info, tone, forcedTone };
			});

			if (isAiMode) {
				processAI(src, tempInfosWithOverrides, looseness);
				return;
			}
			
			// 尝试从字典查询整句
			const dictResult = await queryDict(tempInfosWithOverrides, looseness);
			currentDictResult = dictResult; // 保存到全局变量供render使用
			
			// 获取用户输入的原词（用于排除）
			const userInput = tempInfosWithOverrides.map(info => info.char).join('');
			
			if (dictResult) {
				devLog('字典查询成功');
				devLog('相同字数结果:', dictResult.sameLength);
				devLog('更长字数结果:', dictResult.moreLengths);
			}
			
			let newInfos;
			// 检查 dictResult 是否是多个候选项（字符串数组）
			if (dictResult && dictResult.sameLength && Array.isArray(dictResult.sameLength) && dictResult.sameLength.length > 0) {
				// 优先逐字韵脚匹配（所有字都要满足源词的韵母/声调规则）；若无，再退回“末两字”匹配结果
				const tier = getLoosenessTier(looseness);
				const allowToneRelax = tier >= 2;
				const strongMatches = dictResult.sameLength.filter((phrase) =>
					// 修改：不再排除与用户输入相同的词，以便在结果中显示它
					!phrase.includes(userInput) && phraseFitsSource(phrase, tempInfosWithOverrides, looseness)
				);
				const ranked = strongMatches.length > 0 ? strongMatches : [];
				
				if (ranked.length === 0) {
					// 字典查询没有通过过滤的结果，退回到逐字选择的模式
					newInfos = tempInfosWithOverrides.map((info, idx) => {
						if (info.fin === '-') {
							return { ...info, generated: info.char, locked: false, forcedTone: oldInfos[idx] && oldInfos[idx].forcedTone !== undefined ? oldInfos[idx].forcedTone : null };
						}
						// 保留锁定状态
						if (oldInfos[idx] && oldInfos[idx].locked) {
							return { 
								...info, 
								generated: oldInfos[idx].generated || info.char, 
								locked: true, 
								forcedTone: oldInfos[idx].forcedTone || null 
							};
						}
						const candidate = pickFromMap(info.fin, info.tone, looseness);
						return { 
							...info, 
							generated: candidate || info.char, 
							locked: false, 
							forcedTone: oldInfos[idx] && oldInfos[idx].forcedTone !== undefined ? oldInfos[idx].forcedTone : null 
						};
					});
				} else {
					const firstPhrase = Array.from(ranked[0]); // 第一条作为默认生成
					
					newInfos = tempInfosWithOverrides.map((info, idx) => {
						// 保留锁定状态
						if (oldInfos[idx] && oldInfos[idx].locked) {
							return { 
								...info, 
								generated: oldInfos[idx].generated || info.char, 
								candidates: [], // 锁定状态下不显示候选项
								locked: true, 
								forcedTone: oldInfos[idx].forcedTone || null 
							};
						}
						
						// 为这个位置的所有候选词收集第 idx 个字符
						const charCandidates = [];
						for (const phrase of ranked) {
							const chars = Array.from(phrase);
							if (idx < chars.length) {
								const char = chars[idx];
								if (!charCandidates.includes(char)) {
									charCandidates.push(char);
								}
							}
						}
						
					// 排除会使结果与用户输入相同的字符
					const filteredCandidates = charCandidates.filter(char => {
						// 构建假设选择该字符后的完整词（使用firstPhrase作为基准）
						const testPhrase = firstPhrase.map((c, i) => 
							i === idx ? char : c
						).join('');
						return testPhrase !== userInput;
					});
					
				devLog(`位置 ${idx}: candidates = ${JSON.stringify(filteredCandidates)}`);
					let selectedChar = firstPhrase[idx];
					// 如果 firstPhrase 会导致与用户输入相同，使用过滤后的候选
					const wouldMatchInput = firstPhrase.join('') === userInput;
					if (wouldMatchInput && filteredCandidates.length > 0) {
						selectedChar = filteredCandidates[0];
					} else if (wouldMatchInput && charCandidates.length > 0) {
						// 如果过滤后没有候选，尝试从原始候选中找一个不同的
						const differentChar = charCandidates.find(c => c !== info.char);
						selectedChar = differentChar || charCandidates[0];
					}
					
					return { 
						...info, 
						generated: selectedChar, 
						candidates: filteredCandidates.length > 0 ? filteredCandidates : charCandidates,
						locked: false, 
						forcedTone: oldInfos[idx] && oldInfos[idx].forcedTone !== undefined ? oldInfos[idx].forcedTone : null 
					};
				});
			}
		} else {
			// 字典查询失败,使用原逻辑
			newInfos = tempInfosWithOverrides.map((info, idx) => {
				if (info.fin === '-') {
					return { ...info, generated: info.char, locked: false, forcedTone: oldInfos[idx] && oldInfos[idx].forcedTone !== undefined ? oldInfos[idx].forcedTone : null };
				}
				// 保留锁定状态
				if (oldInfos[idx] && oldInfos[idx].locked) {
					return { 
						...info, 
						generated: oldInfos[idx].generated || info.char, 
						locked: true, 
						forcedTone: oldInfos[idx].forcedTone || null 
					};
				}
				const candidate = pickFromMap(info.fin, info.tone, looseness);
				return { 
					...info, 
					generated: candidate || info.char, 
					locked: false, 
					forcedTone: oldInfos[idx] && oldInfos[idx].forcedTone !== undefined ? oldInfos[idx].forcedTone : null 
				};
			});
		}
		
		currentInfos = newInfos;
		render(currentInfos, currentInfos.map((i) => i.generated).join(''), currentDictResult, userInput);
		
		// Remove loading state
		setTimeout(() => {
			goBtn.classList.remove('loading');
		}, 100);
	};

	// 更新单个字符的声调或韵母
	const updateSingleChar = async (index, newTone, newFinal) => {
		if (!Array.isArray(currentInfos) || index < 0 || index >= currentInfos.length) return;
		
		const isAiMode = document.getElementById('aiMode').checked;

		// 克隆当前信息数组
		const updatedInfos = currentInfos.map((info, idx) => {
			if (idx === index) {
				const updated = { ...info };
				
				// 更新声调
				if (newTone !== null && newTone !== undefined) {
					updated.forcedTone = newTone;
					updated.tone = newTone;
				}
				
				// 更新韵母
				if (newFinal !== null && newFinal !== undefined) {
					updated.forcedFinal = newFinal;
					updated.fin = newFinal;
				}
				
				return updated;
			}
			return info;
		});

		if (isAiMode) {
			const src = document.getElementById('source').value.trim();
			processAI(src, updatedInfos, Number(document.getElementById('looseness').value));
			return;
		}
		
		// 使用更新后的信息重新查询
		const looseness = Number(document.getElementById('looseness').value);
		const dictResult = await queryDict(updatedInfos, looseness);
		currentDictResult = dictResult;
		
		// 获取用户输入的原词
		const userInput = updatedInfos.map(info => info.char).join('');
		
		// 重新生成结果
		let newInfos;
		if (dictResult && dictResult.sameLength && Array.isArray(dictResult.sameLength) && dictResult.sameLength.length > 0) {
			const tier = getLoosenessTier(looseness);
			const strongMatches = dictResult.sameLength.filter((phrase) =>
				!phrase.includes(userInput) && phraseFitsSource(phrase, updatedInfos, looseness)
			);
			const ranked = strongMatches.length > 0 ? strongMatches : [];
			
			if (ranked.length > 0) {
				const firstPhrase = Array.from(ranked[0]);
				newInfos = updatedInfos.map((info, idx) => {
					if (currentInfos[idx] && currentInfos[idx].locked) {
						return { 
							...info, 
							generated: currentInfos[idx].generated || info.char, 
							locked: true
						};
					}
					return {
						...info,
						generated: firstPhrase[idx] || info.char,
						locked: false
					};
				});
			} else {
				newInfos = updatedInfos.map((info, idx) => {
					if (currentInfos[idx] && currentInfos[idx].locked) {
						return { 
							...info, 
							generated: currentInfos[idx].generated || info.char, 
							locked: true
						};
					}
					const candidate = pickFromMap(info.fin, info.tone, looseness);
					return {
						...info,
						generated: candidate || info.char,
						locked: false
					};
				});
			}
		} else {
			// 字典查询失败，使用原逻辑
			newInfos = updatedInfos.map((info, idx) => {
				if (info.fin === '-') {
					return { ...info, generated: info.char, locked: false };
				}
				if (currentInfos[idx] && currentInfos[idx].locked) {
					return { 
						...info, 
						generated: currentInfos[idx].generated || info.char, 
						locked: true
					};
				}
				const candidate = pickFromMap(info.fin, info.tone, looseness);
				return {
					...info,
					generated: candidate || info.char,
					locked: false
				};
			});
		}
		
		currentInfos = newInfos;
		render(currentInfos, currentInfos.map((i) => i.generated).join(''), currentDictResult, userInput);
	};

	const render = (infos, text, dictResult, userInput, skipFilter = false) => {
			// 获取平仄过滤选项
			const pingzeFilter = document.querySelector('input[name="pingze"]:checked')?.value || 'all';
			const looseness = Number(document.getElementById('looseness').value);
			
			// 更新右侧生成结果面板
			const output = document.getElementById('output');
			const badges = document.getElementById('badges');
			
			if (output) {
				// 显示相同字数的所有匹配结果（来自dictResult）
				let results = [];
				
				// 先显示当前生成结果（排除与用户输入相同的词）
				if (text) {
					results.push(text);
				}
				
				// 然后添加字典中的相同字数结果（必须通过phraseFitsSource过滤）
				if (dictResult && dictResult.sameLength && dictResult.sameLength.length > 0) {
					for (const phrase of dictResult.sameLength) {
						// 排除已经在结果中的词（不再排除 userInput，因为它可能已经在 dictResult 中）
						if (phrase !== text && !results.includes(phrase)) {
							// 严格检查该词是否真正符合源词的韵脚要求
							if (skipFilter || phraseFitsSource(phrase, infos, looseness)) {
								results.push(phrase);
							}
						}
					}
				}
				
				// 应用平仄过滤（仅在最松时有效）
				if (looseness >= 1.0 && pingzeFilter !== 'all') {
					results = filterByPingZe(results, pingzeFilter);
				}
				
				// 用制表符分隔显示所有结果在同一行
				const resultText = results.join('\t');
				output.style.whiteSpace = 'pre-wrap';
				output.style.wordBreak = 'keep-all';
				output.style.overflowWrap = 'normal';
				output.textContent = resultText || '-';
				output.style.fontFamily = 'var(--font-sans, "Inter", "Segoe UI", system-ui, -apple-system, sans-serif)';
				output.style.fontSize = '18px';
				output.style.fontWeight = '500';
				output.style.lineHeight = '1.8';
				output.style.letterSpacing = '0.5px';
			}
			
			if (badges) {
				badges.innerHTML = '';
				if (text) {
					const badge = document.createElement('div');
					badge.className = 'badge';
					badge.innerHTML = `<i class="ri-sparkling-line"></i> ${text.length} 字`;
					badges.appendChild(badge);
				}
			}

			// 处理"更多匹配结果"（比用户输入长的词）
			const matchedResults = document.getElementById('matchedResults');
			const matchedResultsList = document.getElementById('matchedResultsList');
			
			if (matchedResultsList && matchedResults) {
				matchedResultsList.innerHTML = '';
				const moreMatches = [];
				
				// 收集比用户输入更长的词
				if (dictResult && dictResult.moreLengths && dictResult.moreLengths.length > 0) {
					moreMatches.push(...dictResult.moreLengths);
				}

				// 过滤尾部重复的词（最后2个字），随机保留一个
				const uniqueTailMatches = [];
				const tailGroups = {};
				
				moreMatches.forEach(phrase => {
					if (!phrase) return;
					
					// 增加一致性过滤：确保更多匹配结果也符合严格的韵脚/声母规则
					// 修复：之前这里漏掉了 phraseFitsSource 检查，导致一些不符合声母规则的词（如平翘舌不匹配）出现在更多结果中
					if (!phraseFitsSource(phrase, infos, looseness)) return;

					const tail = phrase.slice(-2);
					if (!tailGroups[tail]) {
						tailGroups[tail] = [];
					}
					tailGroups[tail].push(phrase);
				});
				
				Object.keys(tailGroups).forEach(tail => {
					const group = tailGroups[tail];
					const randomPhrase = group[Math.floor(Math.random() * group.length)];
					uniqueTailMatches.push(randomPhrase);
				});
				
				// 按字数排序
				uniqueTailMatches.sort((a, b) => a.length - b.length);

/*  */				matchedResultsList.innerHTML = '';
				matchedResultsList.className = 'match-grid';
				
				let hasContent = false;
				uniqueTailMatches.forEach(phrase => {
					if (phrase && phrase !== userInput) {
						const div = document.createElement('div');
						div.className = 'match-item';
						div.textContent = phrase;
						div.dataset.length = phrase.length;
						div.addEventListener('click', () => {
							document.getElementById('source').value = phrase;
							process();
						});
						matchedResultsList.appendChild(div);
						hasContent = true;
					}
				});
				
				// 根据是否有内容来显示或隐藏容器
				matchedResults.style.display = hasContent ? 'block' : 'none';
			}
			
			// 更新下方详情表格
			const body = document.getElementById('detailBody');
			body.innerHTML = '';
			infos.forEach((i, index) => {
				const tr = document.createElement('tr');
				
				// 第一列：原字
				const td1 = document.createElement('td');
				td1.textContent = i.char;
				tr.appendChild(td1);
				
				// 第二列：拼音
				const td2 = document.createElement('td');
				td2.textContent = i.raw || '-';
				tr.appendChild(td2);
				
				// 第三列：声调
				const td3 = document.createElement('td');
				td3.textContent = i.tone || '-';
				tr.appendChild(td3);
				
				// 第四列：韵母+声调控制
				const td4 = document.createElement('td');
				
				// 韵母输入框（可编辑）
				const finInput = document.createElement('input');
				finInput.type = 'text';
				finInput.value = i.fin || '-';
				finInput.dataset.index = index;
				finInput.className = 'fin-input';
				
				// 监听韵母变化
				finInput.addEventListener('change', (e) => {
					const idx = Number(e.target.dataset.index);
					const newFinal = e.target.value.trim() || '-';
					updateSingleChar(idx, null, newFinal);
				});
				
				td4.appendChild(finInput);
				td4.appendChild(document.createTextNode(' '));
				
				if (i.tone !== '-') {
					const select = document.createElement('select');
					select.className = 'tone-select';
					select.dataset.index = index;
					
					const toneSymbols = {
						1: '一',
						2: '／',
						3: 'V',
						4: '＼'
					};
					
					for (let tone = 1; tone <= 4; tone++) {
						const opt = document.createElement('option');
						opt.value = tone;
						opt.textContent = toneSymbols[tone];
						// 只要当前音调等于该选项，就选中
						opt.selected = i.tone == tone;
						select.appendChild(opt);
					}
					
					select.addEventListener('change', (e) => {
						const idx = Number(e.target.dataset.index);
						const val = e.target.value ? Number(e.target.value) : null;
						updateSingleChar(idx, val, null);
					});
					
					td4.appendChild(select);
				}
				tr.appendChild(td4);
				
				body.appendChild(tr);
			});

			// 触发动画
			if (window.triggerResultAnimation) window.triggerResultAnimation();
		};

		const loadOnlineDict = async () => {
			const btn = document.getElementById('loadDictBtn');
			const originalText = btn.textContent;
			btn.innerHTML = '<i class="ri-loader-4-line"></i> 加载中...';
			btn.disabled = true;

			try {
				if (typeof Worker === 'undefined') {
					throw new Error('您的浏览器不支持 Web Worker，无法加载大词库');
				}

				const worker = new Worker('./js/dict-worker.js');
				worker.onmessage = async (event) => {
					const { type, message, data, percent, progress, loaded } = event.data;

					if (type === 'progress') {
						btn.textContent = `${message} ${percent ? percent + '%' : ''}`;
					} else if (type === 'download_progress') {
						if (percent !== undefined) {
							btn.innerHTML = `<i class="ri-download-cloud-2-line"></i> 下载中: ${percent}%`;
						} else {
							btn.innerHTML = `<i class="ri-download-cloud-2-line"></i> 下载中: ${loaded}`;
						}
					} else if (type === 'parsing') {
						btn.textContent = `解析存储中: ${progress || 0}%`;
					} else if (type === 'success') {
						const { chars } = data;
						// 更新本地存储状态（仅用于显示）
						localStorage.setItem('ONLINE_DICT_TIME', Date.now().toString());
						localStorage.setItem('ONLINE_DICT_CACHE', JSON.stringify(chars.slice(0, 100))); // 仅存少量用于显示数量
						localStorage.setItem('ONLINE_DICT_COUNT', chars.length.toString());
						
						// 重建索引
						const keys = await getAllKeysFromDB();
						bloomFilter = new BloomFilter(keys.length * 10, 3);
						keys.forEach(k => bloomFilter.add(k));
						
						btn.textContent = `✓ 已加载`;
						btn.style.background = 'rgba(34, 211, 238, 0.2)';
						window.dictLoaded = true;
						
						setTimeout(() => {
							btn.innerHTML = `✓ 已缓存`;
							btn.disabled = false;
							btn.style.background = '';
							updateDictStatus();
						}, 2000);
						worker.terminate();
					} else if (type === 'error') {
						throw new Error(message);
					}
				};

				worker.onerror = (err) => {
					throw err;
				};

				worker.postMessage({
					action: 'loadAndProcess',
					payload: { 
						dictSources: [
							{ name: '优化词库-1', url: './dict_part_1.json' },
							{ name: '优化词库-2', url: './dict_part_2.json' },
							{ name: '优化词库-3', url: './dict_part_3.json' }
						] 
					}
				});

			} catch (err) {
				console.error('词库加载失败:', err);
				btn.textContent = `✗ ${err.message || '加载失败'}`;
				btn.style.background = 'rgba(239, 68, 68, 0.2)';
				setTimeout(() => {
					btn.textContent = originalText;
					btn.disabled = false;
					btn.style.background = '';
				}, 3000);
			}
		};

		const loadOnlineDictFallback = async () => {
			// Synchronous fallback for browsers without Web Worker support
			const btn = document.getElementById('loadDictBtn');
			const originalText = btn.textContent;

			try {
				// 并行加载3个拆分文件
				const [response1, response2, response3] = await Promise.all([
					fetch('./dict_part_1.json', { method: 'GET', headers: { 'Accept': 'application/json' } }),
					fetch('./dict_part_2.json', { method: 'GET', headers: { 'Accept': 'application/json' } }),
					fetch('./dict_part_3.json', { method: 'GET', headers: { 'Accept': 'application/json' } })
				]);
				
				if (!response1.ok || !response2.ok || !response3.ok) {
					throw new Error('加载词典文件失败');
				}
				
				// 并行解析JSON
				const [data1, data2, data3] = await Promise.all([
					response1.json(),
					response2.json(),
					response3.json()
				]);
				
				// 合并3个数据对象
				const data = {...data1, ...data2, ...data3};

				btn.innerHTML = '<i class="ri-loader-4-line"></i> 解析中...';
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
					btn.innerHTML = `✓ 已缓存`;
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

		// Debounce 函数
		const debounce = (func, delay) => {
			let timeoutId;
			return (...args) => {
				clearTimeout(timeoutId);
				timeoutId = setTimeout(() => func(...args), delay);
			};
		};

		const init = () => {
			document.getElementById('go').addEventListener('click', process);
			const sourceInput = document.getElementById('source');
			
			// 当输入框内容变化时，清除加载状态
			sourceInput.addEventListener('input', () => {
				const goBtn = document.getElementById('go');
				goBtn.classList.remove('loading');
			});
			
			// 键盘快捷键
			sourceInput.addEventListener('keydown', (e) => {
				if (e.key === 'Enter' && !e.shiftKey) {
					e.preventDefault(); // 阻止换行
					process();
				}
			});

			const loosenInput = document.getElementById('looseness');
			const loosenessSelector = document.getElementById('loosenessSelector');
			const segmentBtns = loosenessSelector.querySelectorAll('.segment-btn');
			
			const pingzeFilterContainer = document.getElementById('pingzeFilterContainer');
			
			// 监听分段选择器点击
			segmentBtns.forEach(btn => {
				btn.addEventListener('click', () => {
					// 移除旧的 active 类
					segmentBtns.forEach(b => b.classList.remove('active'));
					// 添加新的 active 类
					btn.classList.add('active');
					// 更新隐藏的 input 值
					const val = btn.dataset.value;
					loosenInput.value = val;
					
					// 触发更新
					updatePingzeFilterVisibility();
					triggerRecalc();
				});
			});
			
			// 监听韵脚宽松度变化，显示/隐藏平仄过滤器
			const updatePingzeFilterVisibility = () => {
				const looseness = Number(loosenInput.value);
				if (looseness >= 1.0) {
					pingzeFilterContainer.style.display = 'block';
				} else {
					pingzeFilterContainer.style.display = 'none';
				}
			};
			
			const triggerRecalc = () => {
				if (document.getElementById('source').value.trim()) process();
			};
			// 使用 debounce，延迟 300ms 后再执行查询
			const debouncedRecalc = debounce(triggerRecalc, 250);
			
			// 初始化平仄过滤器可见性
			updatePingzeFilterVisibility();
			
			// 监听平仄过滤选项变化
			const pingzeRadios = document.querySelectorAll('input[name="pingze"]');
			pingzeRadios.forEach(radio => {
				radio.addEventListener('change', () => {
					if (document.getElementById('source').value.trim()) {
						process();
					}
				});
			});

			const loadDictBtn = document.getElementById('loadDictBtn');
			loadDictBtn.addEventListener('click', loadOnlineDict);

			const clearDictBtn = document.getElementById('clearDictBtn');
			clearDictBtn.addEventListener('click', () => {
				if (!confirm('确定要清理本地缓存的词库数据吗？清理后需要重新加载词库才能正常使用。')) return;
				
				const originalText = clearDictBtn.innerHTML;
				clearDictBtn.innerHTML = '<i class="ri-loader-4-line"></i> 清理中...';
				clearDictBtn.disabled = true;

				const worker = new Worker('./js/dict-worker.js');
				
				// 设置超时保护（10秒）
				const timeoutId = setTimeout(() => {
					console.warn('清理缓存超时，强制关闭');
					worker.terminate();
					handleClearCacheComplete();
				}, 10000);

				// 错误处理
				worker.onerror = (error) => {
					console.error('Worker 错误:', error);
					clearTimeout(timeoutId);
					worker.terminate();
					handleClearCacheComplete();
				};

				const handleClearCacheComplete = () => {
					// 清理 IndexedDB
					try {
						const deleteRequest = indexedDB.deleteDatabase('FakerRhymesDB');
						deleteRequest.onsuccess = () => {
							console.log('IndexedDB 清理成功');
						};
						deleteRequest.onerror = (err) => {
							console.warn('IndexedDB 清理失败:', err);
						};
					} catch (e) {
						console.warn('直接清理 IndexedDB 出错:', e);
					}

					localStorage.removeItem('ONLINE_DICT_TIME');
					localStorage.removeItem('ONLINE_DICT_COUNT');
					localStorage.removeItem('ONLINE_DICT_CACHE');
					localStorage.removeItem('ONLINE_DICT_STATS');
					localStorage.removeItem('ONLINE_DICT_SOURCE');
					
					bloomFilter = new BloomFilter();
					window.dictLoaded = false;
					
					clearDictBtn.innerHTML = '<i class="ri-check-line"></i> 已清理';
					updateDictStatus();
					
					setTimeout(() => {
						clearDictBtn.innerHTML = originalText;
						clearDictBtn.disabled = false;
					}, 1500);
				};

				worker.onmessage = (event) => {
					if (event.data.type === 'clearSuccess') {
						clearTimeout(timeoutId);
						worker.terminate();
						handleClearCacheComplete();
					} else if (event.data.type === 'error') {
						console.error('清理错误:', event.data.message);
						clearTimeout(timeoutId);
						worker.terminate();
						handleClearCacheComplete();
					}
				};
				
				worker.postMessage({ action: 'clearCache' });
			});

			// AI Mode Logic
			const aiModeCheckbox = document.getElementById('aiMode');
			const dictWarning = document.getElementById('dictWarning');
			const aiSettingsModal = document.getElementById('aiSettingsModal');
			const openAiSettingsBtn = document.getElementById('openAiSettings');
			const closeAiSettingsBtn = document.getElementById('closeAiSettings');
			const saveAiSettingsBtn = document.getElementById('saveAiSettings');
			const geminiApiKeyInput = document.getElementById('geminiApiKey');
			const geminiProxyInput = document.getElementById('geminiProxy');

			// Load saved AI settings
			const savedAiMode = localStorage.getItem('AI_MODE') === 'true';
			const savedApiKey = localStorage.getItem('GEMINI_API_KEY') || '';
			const savedProxy = localStorage.getItem('GEMINI_PROXY') || '';
			
			aiModeCheckbox.checked = savedAiMode;
			geminiApiKeyInput.value = savedApiKey;
			geminiProxyInput.value = savedProxy;
			if (savedAiMode) {
				dictWarning.style.display = 'none';
				loadDictBtn.style.display = 'none';
			}

			aiModeCheckbox.addEventListener('change', (e) => {
				const isAi = e.target.checked;
				dictWarning.style.display = isAi ? 'none' : 'block';
				loadDictBtn.style.display = isAi ? 'none' : 'inline-flex';
				localStorage.setItem('AI_MODE', isAi);
				if (isAi && !localStorage.getItem('GEMINI_API_KEY')) {
					aiSettingsModal.classList.add('active');
				}
			});

			// Modal Logic
			openAiSettingsBtn.addEventListener('click', () => {
				aiSettingsModal.classList.add('active');
			});

			const closeModal = () => {
				aiSettingsModal.classList.remove('active');
			};

			closeAiSettingsBtn.addEventListener('click', closeModal);
			aiSettingsModal.addEventListener('click', (e) => {
				if (e.target === aiSettingsModal) closeModal();
			});

			saveAiSettingsBtn.addEventListener('click', () => {
				localStorage.setItem('GEMINI_API_KEY', geminiApiKeyInput.value.trim());
				localStorage.setItem('GEMINI_PROXY', geminiProxyInput.value.trim());
				closeModal();
			});

			// Check if online dict is already loaded
			const updateDictStatus = () => {
				const cachedTime = localStorage.getItem('ONLINE_DICT_TIME');
				const dictStatus = document.getElementById('dictStatus');
				const dictStatusText = document.getElementById('dictStatusText');
				
				if (cachedTime) {
					const count = localStorage.getItem('ONLINE_DICT_COUNT') || '7000+';
					const source = localStorage.getItem('ONLINE_DICT_SOURCE') || '核心词库';
					const date = new Date(Number(cachedTime));
					
					loadDictBtn.innerHTML = `✓ 已缓存`;
					dictStatus.style.display = 'block';
					dictStatusText.textContent = `📖 词库：${count} 个汉字（${source}） | ${date.toLocaleString('zh-CN')}`;
				}
			};
			
			updateDictStatus();

			// Expose debug utilities to window for console access
			window.dictDebug = {
				showStats: function() {
					const stats = localStorage.getItem('ONLINE_DICT_STATS');
					const cache = localStorage.getItem('ONLINE_DICT_CACHE');
					const source = localStorage.getItem('ONLINE_DICT_SOURCE');
					const time = localStorage.getItem('ONLINE_DICT_TIME');
					
					console.clear();
					console.log('%c词库统计信息', 'font-size:16px; font-weight:bold; color:#7c3aed');
					console.log('来源:', source || '未加载');
					console.log('加载时间:', time ? new Date(parseInt(time)).toLocaleString('zh-CN') : '未加载');
					
					if (cache) {
						const chars = JSON.parse(cache);
						console.log('唯一汉字数:', chars.length);
					}
					
					if (stats) {
						const s = JSON.parse(stats);
						console.table({
							'分类数': s.categories.toLocaleString(),
							'条目数（字符串）': s.totalStrings.toLocaleString(),
							'字符总数（去重前）': s.totalChars.toLocaleString(),
							'唯一汉字数': s.uniqueChars.toLocaleString(),
							'重复度': ((1 - s.uniqueChars / s.totalChars) * 100).toFixed(2) + '%'
						});
					} else {
						console.log('（无详细统计，可重新加载词库获取）');
					}
				},
				
				cacheSize: function() {
					let total = 0;
					for (let key in localStorage) {
						if (key.startsWith('ONLINE_DICT_')) {
							const size = localStorage[key].length;
							console.log(`${key}: ${(size / 1024).toFixed(2)} KB`);
							total += size;
						}
					}
					console.log(`总计: ${(total / 1024 / 1024).toFixed(2)} MB`);
				}
			};
			
			console.log('%c💡 提示', 'color:#22d3ee; font-weight:bold');
			console.log('在控制台执行以下命令查看词库信息：');
			console.log('  • window.dictDebug.showStats()  - 显示详细统计');
			console.log('  • window.dictDebug.cacheSize()  - 显示缓存大小');

			loadScriptSeq([...cdnList], (err, url) => {
				if (err) {
					setOutputStatus('pinyin-pro 未加载，已尝试备用 CDN。可手动下载 pinyin-pro.js 放在同目录。');
					return;
				}
				pinyinReady = true;
				bankMap = registerBank();
				setOutputStatus(`pinyin-pro 已加载 (${url})，可点击生成。`);
			});
			
			// 立即加载优化字典
			loadDict();

			// 启动页面基础动画
			if (window.startMainAnimations) {
				window.startMainAnimations();
			}
		};

		init();