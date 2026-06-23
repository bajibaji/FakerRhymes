		// Final to short code mapping
		// 编码版本历史:
		//   v2: 'ü':'y' — 与 'v':'y' 一致，修复 ü 编码
		//   v3 (当前): 新增 'van':'B' 映射（修复 üan 缺失编码），移除 legacyKeyMap 旧键扩展
		const DICT_ENCODING_VERSION = '4';
		const finalToCode = {
			'iong': '0', 'uang': '1', 'iang': '2', 'ueng': '3', 'uan': '4', 'ian': '5', 'uen': '6', 'iao': '7', 'uai': '8',
			'ang': '9', 'eng': 'a', 'ing': 'b', 'ong': 'c', 'ai': 'd', 'ei': 'e', 'ao': 'f', 'ou': 'g', 'an': 'h', 'en': 'i',
			'in': 'j', 'un': 'k', 'vn': 'l', 'ia': 'm', 'ua': 'n', 'uo': 'o', 'ie': 'p', 'ue': 'q', 've': 'q', 'ui': 'r', 'er': 's',
			'a': 't', 'o': 'u', 'e': 'v', 'i': 'w', 'u': 'x', 'v': 'y', 'van': 'B', 'i-flat': 'z', 'i-retro': 'A', 'ü': 'y',
			'iu': 'g', 'iou': 'g'
		};

		function encodeKey(key) {
			if (!key) return '';
			return key.split('_').map(part => {
				const match = part.match(/^(.+)([0-4])$/);
				if (match) {
					const [_, final, tone] = match;
					const code = finalToCode[final];
					if (!code) return null;
					return code + tone;
				}
				return part;
			}).filter(Boolean).join('');
		}

const devLog = (...args) => {
			console.log('[Dev]', ...args);
		};

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
		let currentSearchId = 0; // 搜索任务 ID，用于中断旧任务
		let isAiLoading = false; // AI 请求锁，防止并发请求触发 429
		let slowQueryTimer = null;

		const HISTORY_KEY = 'FakerRhymes_History';
		const MAX_HISTORY = 5;

		const setDictLoadStatus = (msg, type = 'info') => {
			const el = document.getElementById('dictLoadStatus');
			if (!el) return;
			el.textContent = msg || '';
			el.dataset.type = type;
			
			// 流式加载、导入或错误时红色加粗显示（用 setProperty important 防 CSS 覆盖）
			if (msg && (msg.includes('正在') || msg.includes('载入') || msg.includes('导入') || type === 'error')) {
				el.style.setProperty('color', '#fb7185', 'important');
				el.style.setProperty('font-weight', 'bold', 'important');
			} else {
				el.style.setProperty('color', '', '');
				el.style.setProperty('font-weight', '', '');
			}
		};

		// 屏幕顶部细进度条
		const setTopProgress = (percent) => {
			const bar = document.getElementById('topProgressBar');
			if (!bar) return;
			const pct = Math.min(100, Math.max(0, percent));
			bar.style.width = pct + '%';
			bar.classList.remove('complete', 'error');
		};

		const setQueryStatus = (msg = '') => {
			const el = document.getElementById('queryStatus');
			if (!el) return;
			if (!msg) {
				el.style.display = 'none';
				el.textContent = '';
				return;
			}
			el.style.display = 'block';
			el.textContent = msg;
		};

		const clearSlowQueryFeedback = () => {
			if (slowQueryTimer) {
				clearTimeout(slowQueryTimer);
				slowQueryTimer = null;
			}
			setQueryStatus('');
		};

		const scheduleSlowQueryFeedback = (searchId) => {
			clearSlowQueryFeedback();
			slowQueryTimer = setTimeout(() => {
				if (searchId === currentSearchId) {
					setQueryStatus('正在扩展匹配范围，请稍候...');
				}
			}, 300);
		};

		const readList = (key) => {
			try {
				const raw = localStorage.getItem(key);
				const list = raw ? JSON.parse(raw) : [];
				return Array.isArray(list) ? list : [];
			} catch (e) {
				console.warn('读取列表失败:', key, e);
				return [];
			}
		};

		const writeList = (key, list) => {
			try {
				localStorage.setItem(key, JSON.stringify(list));
			} catch (e) {
				console.warn('写入列表失败:', key, e);
			}
		};

		const addToHistory = (phrase) => {
			const normalized = String(phrase || '').trim();
			if (!normalized) return;
			const list = readList(HISTORY_KEY).filter(item => item !== normalized);
			list.unshift(normalized);
			writeList(HISTORY_KEY, list.slice(0, MAX_HISTORY));
		};

		const getAiErrorHint = (rawMessage) => {
			const msg = String(rawMessage || '');
			const lower = msg.toLowerCase();
			if (!msg) return '请检查 API Key 或代理设置，然后重试。';
			if (lower.includes('failed to fetch') || lower.includes('networkerror')) {
				return '网络连接失败，请检查代理地址或本地网络连接。';
			}
			if (lower.includes('api key not valid') || lower.includes('permission denied')) {
				return 'API Key 无效或无权限，请在 AI 设置中重新填写。';
			}
			if (lower.includes('quota') || lower.includes('429') || lower.includes('resource_exhausted')) {
				return '请求频率或额度已达上限，请稍后再试。';
			}
			if (lower.includes('403')) {
				return '请求被拒绝，请确认 Key 权限和请求来源。';
			}
			if (lower.includes('deadline') || lower.includes('timeout')) {
				return '请求超时，请稍后重试或更换代理。';
			}
			return '请检查 AI 设置后重试。';
		};

		const hasChineseChars = (text) => /[\u4e00-\u9fa5]/.test(String(text || ''));
		const isOnlyChinese = (text) => /^[\u4e00-\u9fa5]+$/.test(String(text || ''));

		let dictBuffer = null;
		let entryCount = 0;
		let keysStart = 0;
		let wordsStart = 0;
		let indexView = null; // Uint32Array
		let keysArray = null; // Uint8Array
		let wordsArray = null; // Uint8Array

		let wasmModule = null;
		let isWasmEnabled = false;

		async function initWasmEngine(combinedArray) {
			try {
				const module = await import('./pkg/wasm_search.js');
				await module.default();
				const success = module.init_dict(combinedArray);
				if (success) {
					wasmModule = module;
					isWasmEnabled = true;
					devLog('WASM 检索引擎就绪！');
				} else {
					console.warn('WASM init_dict 返回失败，降级使用 JS 二分引擎。');
				}
			} catch (e) {
				console.warn('WASM 引擎载入失败，降级使用 JS 二分引擎，详情:', e);
			}
		}

		const utf8Decoder = new TextDecoder('utf-8');

		function getKeyString(i) {
			const keyOffset = indexView[i * 3];
			const keyLen = keysArray[keyOffset];
			let s = '';
			for (let j = 0; j < keyLen; j++) {
				s += String.fromCharCode(keysArray[keyOffset + 1 + j]);
			}
			return s;
		}

		function getWordsString(i) {
			const wordsOffset = indexView[i * 3 + 1];
			const wordsLen = indexView[i * 3 + 2];
			const slice = wordsArray.subarray(wordsOffset, wordsOffset + wordsLen);
			return utf8Decoder.decode(slice);
		}

		function queryExact(targetKeyReversed) {
			let low = 0;
			let high = entryCount - 1;
			while (low <= high) {
				const mid = (low + high) >> 1;
				const midKey = getKeyString(mid);
				if (midKey === targetKeyReversed) {
					return getWordsString(mid);
				} else if (midKey < targetKeyReversed) {
					low = mid + 1;
				} else {
					high = mid - 1;
				}
			}
			return null;
		}

		function queryPrefixRange(prefixReversed) {
			let low = 0;
			let high = entryCount - 1;
			while (low <= high) {
				const mid = (low + high) >> 1;
				const midKey = getKeyString(mid);
				if (midKey < prefixReversed) {
					low = mid + 1;
				} else {
					high = mid - 1;
				}
			}
			const results = [];
			for (let i = low; i < entryCount; i++) {
				const key = getKeyString(i);
				if (key.startsWith(prefixReversed)) {
					const wordsStr = getWordsString(i);
					if (wordsStr) {
						results.push(wordsStr);
					}
				} else {
					break;
				}
			}
			return results;
		}

		const loadDict = async () => {
			if (window.isDictLoading) return;
			window.isDictLoading = true;
			setDictLoadStatus('正在极速载入词库...');
			setTopProgress(10);

			const btn = document.getElementById('go');
			if (btn) {
				btn.disabled = true;
				btn.innerHTML = '<i class="ri-loader-4-line"></i> 载入中...';
			}

			try {
				const startTime = performance.now();

				const storedVersion = localStorage.getItem('DICT_ENCODING_VERSION');
				if (storedVersion !== DICT_ENCODING_VERSION) {
					devLog(`字典版本变动 (v${storedVersion || '1'} → v${DICT_ENCODING_VERSION})`);
				}

				setTopProgress(40);
				
				const fetchUrl1 = new URL('dict_part1.bin', window.location.href).href;
				const fetchUrl2 = new URL('dict_part2.bin', window.location.href).href;
				
				const [response1, response2] = await Promise.all([
					fetch(fetchUrl1),
					fetch(fetchUrl2)
				]);
				
				if (!response1.ok) throw new Error(`HTTP error part 1! status: ${response1.status}`);
				if (!response2.ok) throw new Error(`HTTP error part 2! status: ${response2.status}`);
				
				setTopProgress(70);
				const buf1 = await response1.arrayBuffer();
				const buf2 = await response2.arrayBuffer();
				
				setTopProgress(85);
				const totalLength = buf1.byteLength + buf2.byteLength;
				const combinedArray = new Uint8Array(totalLength);
				combinedArray.set(new Uint8Array(buf1), 0);
				combinedArray.set(new Uint8Array(buf2), buf1.byteLength);
				
				setTopProgress(95);
				dictBuffer = combinedArray.buffer;
				const header = new DataView(dictBuffer, 0, 24);
				entryCount = header.getUint32(0, true);
				keysStart = header.getUint32(4, true);
				wordsStart = header.getUint32(8, true);
				const totalWords = header.getUint32(12, true);
				const lyricCount = header.getUint32(16, true);

				indexView = new Uint32Array(dictBuffer, 24, entryCount * 3);
				keysArray = new Uint8Array(dictBuffer, keysStart, wordsStart - keysStart);
				wordsArray = new Uint8Array(dictBuffer, wordsStart);

				window.dictLoaded = true;
				window.isDictLoading = false;
				localStorage.setItem('ONLINE_DICT_TIME', String(Date.now()));
				localStorage.setItem('ONLINE_DICT_COUNT', String(totalWords));
				localStorage.setItem('ONLINE_DICT_LYRIC_COUNT', String(lyricCount));
				localStorage.setItem('DICT_ENCODING_VERSION', DICT_ENCODING_VERSION);
				
				await initWasmEngine(combinedArray);

				setDictLoadStatus('词库已就绪，可离线使用。', 'success');
				devLog('二进制词库分片合并就绪总耗时:', (performance.now() - startTime).toFixed(2), 'ms', '大小:', (dictBuffer.byteLength / 1024 / 1024).toFixed(2), 'MB');
				setTopProgress(100);
				
				setTimeout(() => {
					const bar = document.getElementById('topProgressBar');
					if (bar) bar.classList.add('complete');
				}, 800);
				
				if (btn) {
					btn.disabled = false;
					btn.innerHTML = '生成押韵';
					btn.style.background = '';
					btn.classList.remove('error');
				}
				
				updateDictStatus();

				const warning = document.getElementById('dictWarning');
				if (warning) {
					warning.innerHTML = '<i class="ri-checkbox-circle-fill" style="margin-right:2px;"></i> 词库已就绪 (内存直连)';
					warning.style.color = '#10b981';
					warning.style.display = 'block';
				}

			} catch (e) {
				console.error('二进制词库载入失败:', e);
				window.isDictLoading = false;
				window.dictLoaded = false;

				const errMsg = (e.message || '').toLowerCase();
				let userMsg = '词库加载失败，请点击按钮重试。';
				if (errMsg.includes('failed to fetch') || errMsg.includes('network')) {
					userMsg = '网络连接失败，请检查网络后点击重试。';
				} else if (errMsg.includes('quota') || errMsg.includes('storage') || errMsg.includes('memory')) {
					userMsg = '设备内存不足，请清理后台应用后重试。';
				}
				userMsg += ` (详情: ${e.message || e})。若刚更新过代码，请按 Ctrl+F5 强制刷新页面以清除浏览器缓存。`;

				setDictLoadStatus(userMsg, 'error');
				setTopProgress(100);
				setTimeout(() => {
					const bar = document.getElementById('topProgressBar');
					if (bar) bar.classList.add('error');
				}, 100);

				if (btn) {
					btn.innerHTML = '<i class="ri-restart-line"></i> 点击重试加载';
					btn.disabled = false;
					btn.style.background = 'linear-gradient(135deg, #fb7185, #fde047)';
				}

				const warning = document.getElementById('dictWarning');
				if (warning) {
					warning.innerHTML = '<i class="ri-error-warning-fill" style="margin-right:2px;"></i> 词库未就绪，点击按钮重试';
					warning.style.color = '#fb7185';
					warning.style.display = 'block';
				}
			}
		};

		const updateDictStatus = () => {
			const cachedTime = localStorage.getItem('ONLINE_DICT_TIME');
			const dictStatus = document.getElementById('dictStatus');
			const dictStatusText = document.getElementById('dictStatusText');
			const goBtn = document.getElementById('go');
			
			if (cachedTime) {
				const count = localStorage.getItem('ONLINE_DICT_COUNT') || '?';
				const lyricCount = localStorage.getItem('ONLINE_DICT_LYRIC_COUNT') || '?';
				const date = new Date(Number(cachedTime));
				
				if (goBtn) {
					goBtn.innerHTML = '生成押韵';
					goBtn.disabled = false;
				}
				window.dictLoaded = true;
				
				const fmtNum = (v) => isNaN(Number(v)) ? String(v) : Number(v).toLocaleString();
				dictStatus.style.display = 'block';
				dictStatusText.textContent = `词库：共 ${fmtNum(count)} 个词语（歌词 ${fmtNum(lyricCount)} 个） | ${date.toLocaleString('zh-CN')}`;
				setDictLoadStatus('检测到本地词库缓存，可直接使用。', 'success');
			} else {
				if (goBtn) {
					goBtn.innerHTML = '<i class="ri-book-read-line"></i> 加载词库';
					goBtn.disabled = false;
				}
				window.dictLoaded = false;
				setDictLoadStatus('首次使用将自动加载词库，请稍候。');
			}
		};

		const filterByPingZe = (phrases, type) => {
			if (!phrases || !Array.isArray(phrases) || !type || type === 'all') return phrases;
			return phrases.filter(phrase => {
				if (!phrase) return false;
				const lastChar = phrase.endsWith('*') ? phrase.slice(-2, -1) : phrase.slice(-1);
				const info = toInfo(lastChar);
				if (!info || info.tone === '-') return false;
				const tone = Number(info.tone);
				if (type === 'ping') {
					return tone === 1 || tone === 2;
				} else if (type === 'ze') {
					return tone === 3 || tone === 4;
				}
				return true;
			});
		};

	const normalize = (p) => p.replace(/\d/g, '').replace(/ü/g, 'v').replace(/u:/g, 'v');

	// 将键统一转成 v 形式。v 与 ü 在 finalToCode 中均映射为 'y'，
	// 不再生成 u 变体（u→'x' 与 ü→'y' 编码不同，会产生无效查询键）
	const buildKeyVariants = (key) => {
		const base = String(key).replace(/ü/g, 'v').replace(/u:/g, 'v');
		return [base];
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

			if (!raw || !/^[a-z]+[0-4]?$/i.test(String(raw))) return null;

			const clean = normalize(raw);
			const tone = extractTone(raw);
			const parts = detectFinal(clean);
			return parts ? { char, raw, clean, tone, fin: parts.final, ini: parts.initial } : null;
		};

		const getPolyphonicCandidates = (char) => {
			if (!window.pinyinPro || !window.pinyinPro.pinyin) return [];

			const values = new Set();
			const pushText = (val) => {
				if (typeof val !== 'string') return;
				val
					.split(/[,\s/|]+/)
					.map(item => item.trim())
					.filter(Boolean)
					.forEach(item => values.add(item));
			};

			const collect = (input) => {
				if (!input) return;
				if (Array.isArray(input)) {
					input.flat(Infinity).forEach(collect);
					return;
				}
				pushText(input);
			};

			try {
				collect(window.pinyinPro.pinyin(char, {
					type: 'array',
					toneType: 'num',
					pattern: 'pinyin',
					multiple: true
				}));
			} catch (e) {}

			try {
				collect(window.pinyinPro.pinyin(char, {
					toneType: 'num',
					pattern: 'pinyin',
					multiple: true
				}));
			} catch (e) {}

			const fallback = toInfo(char);
			if (fallback && fallback.raw) values.add(fallback.raw);

			const candidates = [];
			values.forEach(raw => {
				const clean = normalize(raw);
				const tone = extractTone(raw);
				const parts = detectFinal(clean);
				if (!parts) return;
				candidates.push({
					raw,
					tone,
					fin: parts.final,
					ini: parts.initial
				});
			});

			const dedup = [];
			const seen = new Set();
			for (const item of candidates) {
				const key = `${item.raw}-${item.tone}-${item.fin}`;
				if (seen.has(key)) continue;
				seen.add(key);
				dedup.push(item);
			}
			return dedup;
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
			{ name: '言前辙', finals: ['an', 'ian', 'uan', 'van'] },
			{ name: '人辰辙-深', finals: ['en', 'un'] },
			{ name: '人辰辙-亲', finals: ['in', 'vn'] },
			{ name: '江阳辙', finals: ['ang', 'iang', 'uang'] },
			{ name: '中东辙', finals: ['eng', 'ing', 'ong', 'iong'] },
			{ name: '一七辙', finals: ['i', 'v', 'er', 'i-flat', 'i-retro'] },
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

		// legacyKeyMap 已在 v2/v3 编码迁移中废弃，v1 旧键不再存在于数据库中

		// 从字典查询拼音组合对应的词组（新算法）
		// 使用最后两个字的韵脚为查询条件，返回所有相关匹配
		const queryDict = async (infos, looseness, onIncrementalUpdate = null, searchId = 0) => {
			if (!infos || infos.length === 0) return null;

			// 降级查询缓存：避免对同一 infos 集重复执行昂贵的数据库查询
			if (!queryDict._degradeCache) queryDict._degradeCache = new Map();

			const emit = (res, isFinal = false) => {
				// 核心：如果当前的 searchId 已经不是全局最新的，说明任务已过时，直接中断
				if (searchId !== currentSearchId) return false;
				
				if (onIncrementalUpdate) {
					onIncrementalUpdate({
						sameLength: res.sameLength || [],
						moreLengths: res.moreLengths || [],
						lessLength: res.lessLength || [],
						isFinal
					});
				}
				return true;
			};
			
			// 1. 核心极速逻辑：如果词库还没准备好，触发懒加载并等待完成
			if (!window.dictLoaded && !window.isDictLoading) {
				console.log('触发词库自动挂载...');
				await loadDict();
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
				const MAX_COMBINATIONS = 2000;

				const recurse = (index, current) => {
					if (keys.length >= MAX_COMBINATIONS) return;
					if (index === infos.length) {
						keys.push(current.join('_'));
						return;
					}
					const info = infos[index];
					// Tier 2: 所有字都允许声调放宽（因为只处理最后两个字，组合数可控）
					// Tier 0/1: 必须严格匹配声调
					const toneVariants = allowToneRelax ? [1,2,3,4] : [info.tone];

					// 获取该韵母的所有变体（无需 legacyKeyMap 扩展，v1 旧键已迁移）
					const finVariants = buildFinalVariants(info.fin, tier);

					for (const fin of finVariants) {
						for (const tone of toneVariants) {
							const keyPart = `${fin}${tone}`;
							recurse(index + 1, [...current, keyPart]);
							if (keys.length >= MAX_COMBINATIONS) break;
						}
						if (keys.length >= MAX_COMBINATIONS) break;
					}
				};
				recurse(0, []);
				return keys;
			};
			
			const queryKeys = generateQueryKeys(validInfos);
			devLog(`[Tier ${tier}] 生成原始查询键数量: ${queryKeys.length}`);
			const queryVariantSet = new Set();
			queryKeys.forEach(k => {
				buildKeyVariants(k).forEach(v => {
					const encoded = encodeKey(v);
					// 内存模式下直接信任内存数据，不使用 Bloom Filter 过滤以防漏掉结果
					queryVariantSet.add(encoded);
				});
			});
			devLog(`[Tier ${tier}] 编码后的查询变体数量: ${queryVariantSet.size}`);
			
			// 在字典中搜索所有可能的匹配
			// 使用 Set 替代 Array 做去重，O(1) 插入/查找
			const matchedByWordCount = {}; // { len: Set<phrase> }
			const sourceLength = infos.length;
			
			// 批量查询所有变体
			const variantKeys = Array.from(queryVariantSet);
			
			// 辅助：向 matchedByWordCount 插入一条结果
			const addMatch = (phrase) => {
				const phraseLen = phrase.endsWith('*') ? phrase.length - 1 : phrase.length;
				if (!matchedByWordCount[phraseLen]) matchedByWordCount[phraseLen] = new Set();
				matchedByWordCount[phraseLen].add(phrase);
			};
	
			// 1. 精确匹配（二分查找）
			if (window.dictLoaded) {
				if (isWasmEnabled && wasmModule) {
					try {
						const resStr = wasmModule.query_exact_batch(variantKeys);
						if (resStr) {
							resStr.split(',').forEach(phrase => {
								if (phrase) {
									addMatch(phrase);
								}
							});
						}
					} catch (e) {
						console.warn('WASM 精确匹配批量查询失败，降级到 JS 二分查找:', e);
						if (indexView) {
							for (const qk of variantKeys) {
								const qkReversed = qk.split('').reverse().join('');
								const wordsStr = queryExact(qkReversed);
								if (wordsStr) {
									wordsStr.split(',').forEach(phrase => {
										addMatch(phrase);
									});
								}
							}
						}
					}
				} else if (indexView) {
					for (const qk of variantKeys) {
						const qkReversed = qk.split('').reverse().join('');
						const wordsStr = queryExact(qkReversed);
						if (wordsStr) {
							wordsStr.split(',').forEach(phrase => {
								addMatch(phrase);
							});
						}
					}
				}
			}
	
			// 立即渲染第一批结果（精确匹配）
			const getCategorized = () => {
				const res = { sameLength: [], moreLengths: [], lessLength: [] };
				Object.keys(matchedByWordCount).forEach(len => {
					const l = Number(len);
					const arr = Array.from(matchedByWordCount[len]);
					if (l === sourceLength) res.sameLength.push(...arr);
					else if (l > sourceLength) res.moreLengths.push(...arr);
					else if (l < sourceLength) res.lessLength.push(...arr);
				});
				return res;
			};
			
			emit(getCategorized());
	
			// 2. 后缀匹配（二进制前缀范围扫描）
			if (queryVariantSet.size > 0 && window.dictLoaded) {
				if (searchId !== currentSearchId) return null;
	
				if (isWasmEnabled && wasmModule) {
					try {
						const suffixes = [];
						for (const qk of queryVariantSet) {
							if (qk.length >= 2) {
								suffixes.push(qk);
							}
						}
						if (suffixes.length > 0) {
							const resStr = wasmModule.query_suffix_batch(suffixes);
							if (resStr) {
								resStr.split(',').forEach(phrase => {
									if (phrase && phrase.length > sourceLength) {
										addMatch(phrase);
									}
								});
							}
							devLog(`[Tier ${tier}] WASM 后缀匹配完成`);
						}
					} catch (e) {
						console.warn('WASM 后缀匹配批量查询失败，降级到 JS 后缀扫描:', e);
						if (indexView) {
							const suffixesReversed = [];
							for (const qk of queryVariantSet) {
								if (qk.length >= 2) {
									suffixesReversed.push(qk.split('').reverse().join(''));
								}
							}
							if (suffixesReversed.length > 0) {
								let count = 0;
								for (const suffixReversed of suffixesReversed) {
									const wordsStrList = queryPrefixRange(suffixReversed);
									for (const wordsStr of wordsStrList) {
										const phrases = wordsStr.split(',');
										for (const phrase of phrases) {
											if (phrase.length > sourceLength) {
												addMatch(phrase);
											}
										}
									}
									count++;
									if (count > 2000) break;
								}
								devLog(`[Tier ${tier}] 二进制二分后缀匹配完成`);
							}
						}
					}
				} else if (indexView) {
					const suffixesReversed = [];
					for (const qk of queryVariantSet) {
						if (qk.length >= 2) {
							suffixesReversed.push(qk.split('').reverse().join(''));
						}
					}
					if (suffixesReversed.length > 0) {
						let count = 0;
						for (const suffixReversed of suffixesReversed) {
							const wordsStrList = queryPrefixRange(suffixReversed);
							for (const wordsStr of wordsStrList) {
								const phrases = wordsStr.split(',');
								for (const phrase of phrases) {
									if (phrase.length > sourceLength) {
										addMatch(phrase);
											}
										}
									}
						count++;
						if (count > 2000) break; // 性能兜底，防止极端情况卡死
								}
						devLog(`[Tier ${tier}] 二进制二分后缀匹配完成`);
							}
						}
					}
			
			emit(getCategorized()); // 后缀查询完更新一次

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
										addMatch(phrase);
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
			sameLengthResults.push(...Array.from(matchedByWordCount[len]));
		}
		
		// 收集所有短于输入的匹配
		const lessLengthCandidates = sortedLengths.filter(len => len < sourceLength);
		for (const len of lessLengthCandidates) {
			lessLengthResults.push(...Array.from(matchedByWordCount[len]));
		}
		
		// 如果没有相同字数的匹配，且源字数大于2，尝试降级查询
		if (sameLengthResults.length === 0 && sourceLength > 2) {
			console.log(`[Debug] No exact match for ${sourceLength} chars, trying degraded query...`);
			let currentLength = sourceLength - 1;
			// 避免死循环，增加最大降级次数限制
			while (currentLength >= 2) {
				// 取末尾 currentLength 个字重新查询
				console.log(`[Debug] Degrading to ${currentLength} chars...`);
				const shorterInfos = infos.slice(-currentLength);
				const cacheKey = shorterInfos.map(i => `${i.fin}${i.tone}`).join('_') + '_' + looseness;
				let shorterResult;
				if (queryDict._degradeCache.has(cacheKey)) {
					shorterResult = queryDict._degradeCache.get(cacheKey);
				} else {
					shorterResult = await queryDict(shorterInfos, looseness);
					queryDict._degradeCache.set(cacheKey, shorterResult);
				}
				
				if (shorterResult && shorterResult.sameLength && shorterResult.sameLength.length > 0) {
					console.log(`[Debug] Degraded query found results!`);
					sameLengthResults.push(...shorterResult.sameLength);

					// 修复：保留降级查询中发现的长词
					// shorterResult.moreLengths 里的词，长度肯定 > currentLength
					if (shorterResult.moreLengths && shorterResult.moreLengths.length > 0) {
						console.log(`[Debug] Recovering ${shorterResult.moreLengths.length} longer words from degraded query...`);
						for (const phrase of shorterResult.moreLengths) {
							const cleanPhrase = phrase.endsWith('*') ? phrase.slice(0, -1) : phrase;
							const pLen = Array.from(cleanPhrase).length;
							
							// 如果这个长词的长度等于原始查询长度，把它算作“同长匹配”
							if (pLen === sourceLength) {
								if (!sameLengthResults.includes(phrase)) {
									sameLengthResults.push(phrase);
								}
							}
							// 如果真的比原始查询还长，放入“更多匹配”
							else if (pLen > sourceLength) {
								if (!moreLengthResults.includes(phrase)) {
									moreLengthResults.push(phrase);
								}
							}
							// 如果介于 currentLength 和 sourceLength 之间（理论上不太可能，因为 currentLength = sourceLength - 1）
							// 或者就是 currentLength，那它应该在 shorterResult.sameLength 里
						}
					}
					
					// 还要把 shorterResult.sameLength 里长度大于 sourceLength 的也加进去（虽然理论上不会有）
					// 但如果是从 4->3 降级，3字结果对于4字查询来说是“短”的，
					// 但对于3字查询来说是“同长”的。
					// 这里我们主要关心的是补全 moreLengthResults
					
					devLog(`降级查询成功：从 ${sourceLength} 字降到 ${currentLength} 字`);
					break;
				}
				
				currentLength--;
			}
		}
		
		// 然后添加所有字数更多的匹配
		const moreLengthCandidates = sortedLengths.filter(len => len > sourceLength);
		for (const len of moreLengthCandidates) {
			moreLengthResults.push(...Array.from(matchedByWordCount[len]));
		}
		console.log(`queryDict结果: sameLength=${sameLengthResults.length}, moreLengths=${moreLengthResults.length}, sourceLength=${sourceLength}`);

		queryDict._degradeCache.clear();
		
		return {
			sameLength: sameLengthResults.length > 0 ? sameLengthResults : [],
			lessLength: lessLengthResults.length > 0 ? lessLengthResults : [],
			moreLengths: moreLengthResults.length > 0 ? moreLengthResults : []
		};
	};

	// 显式暴露核心函数供性能测试脚本使用
	window.loadDict = loadDict;
	window.toInfo = toInfo;
	window.queryDict = queryDict;

		const buildFinalVariants = (fin, tier) => {
			// Tier 0: 严格模式，完全匹配
			if (tier === 0) {
				// 数据文件使用 plain i 编码，detectFinal 区分了 i-flat/i-retro
				// 三个 i 变体在押韵上等价，必须互相匹配才能查到结果
				if (fin === 'i-flat' || fin === 'i-retro' || fin === 'i') {
					return ['i', 'i-flat', 'i-retro'];
				}
				return [fin];
			}

			// Tier 1 & 2: 以十三辙为单位放宽韵母匹配
			// 十三辙是传统中文押韵体系，辙内韵母相互押韵
			// 不使用前后鼻音合并（如 an+ang、en+eng），因为它们在标准押韵中不通押
			const track = thirteenTracks.find(t => t.finals.includes(fin));
			return track ? track.finals : [fin];
		};

		const normalizeSpecialFinal = (fin) => {
			// 旧逻辑残留，现在直接返回 fin 即可
			return fin;
		};

		// 检查候选短语是否逐字匹配源词的韵脚，并返回匹配等级 (0: strict, 1: medium, 2: loose, -1: mismatch)
		const getPhraseMatchTier = (phrase, sourceInfos, looseness) => {
			if (typeof phrase === 'string' && phrase.endsWith('*')) {
				phrase = phrase.slice(0, -1);
			}
			const tierLimit = getLoosenessTier(looseness);
			const chars = Array.from(phrase);
			
			const len = Math.min(chars.length, sourceInfos.length);
			const srcOffset = sourceInfos.length - len;
			const phraseOffset = chars.length - len;

			const specialInitials = ['zh', 'ch', 'sh', 'r', 'z', 'c', 's'];
			let maxTierFound = 0;

			for (let i = 0; i < len; i++) {
				const src = sourceInfos[srcOffset + i];
				const ch = chars[phraseOffset + i];
				const pInfo = ch ? toInfo(ch) : null;
				if (!src || !pInfo || !src.fin || src.fin === '-') return -1;
				
				let currentMatchTier = -1;
				
				// 1. 尝试严格匹配
				// 修复：严格模式下也必须允许变体（如 i 和 i-retro 的互通），不能仅仅用 ===
				if (src.tone === pInfo.tone && buildFinalVariants(src.fin, 0).includes(pInfo.fin)) {
					currentMatchTier = 0;
				} 
				// 2. 尝试中等匹配 (同调，但韵母放宽)
				else if (src.tone === pInfo.tone && buildFinalVariants(src.fin, 1).includes(pInfo.fin)) {
					currentMatchTier = 1;
				}
				// 3. 尝试最松匹配 (韵母放宽，忽略声调)
				else if (buildFinalVariants(src.fin, 2).includes(pInfo.fin)) {
					currentMatchTier = 2;
				}

				// 如果该字的匹配等级超过了用户设置的限制，或者根本不匹配
				if (currentMatchTier === -1 || currentMatchTier > tierLimit) return -1;
				
				maxTierFound = Math.max(maxTierFound, currentMatchTier);

			}
			return maxTierFound;
		};

		// 保持兼容性的旧函数，现在内部调用 getPhraseMatchTier
		const phraseFitsSource = (phrase, sourceInfos, looseness) => {
			return getPhraseMatchTier(phrase, sourceInfos, looseness) !== -1;
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

		const getGeminiBaseUrl = (proxy) => {
			if (!proxy) return 'https://generativelanguage.googleapis.com';
			const normalized = proxy.trim().replace(/\/$/, '');
			const url = new URL(normalized);
			const isLocalHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
			if (url.protocol !== 'https:' && !isLocalHttp) {
				throw new Error('代理地址必须使用 HTTPS（本机 localhost 除外），避免 API Key 明文泄露');
			}
			if (url.username || url.password) {
				throw new Error('代理地址不能包含用户名或密码');
			}
			return normalized;
		};

		const requestGemini = async (prompt, apiKey, proxy, model = 'gemini-2.0-flash') => {
			const baseUrl = getGeminiBaseUrl(proxy);
			const response = await fetch(`${baseUrl}/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
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
			const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
			if (!text) {
				throw new Error('AI 未返回有效内容');
			}
			return text;
		};

		const getDefaultBaseUrl = (provider) => {
			switch (provider) {
				case 'openai': return 'https://api.openai.com/v1';
				case 'claude': return 'https://api.anthropic.com';
				case 'deepseek': return 'https://api.deepseek.com';
				case 'siliconflow': return 'https://api.siliconflow.cn/v1';
				case 'moonshot': return 'https://api.moonshot.cn/v1';
				case 'groq': return 'https://api.groq.com/openai/v1';
				case 'openrouter': return 'https://openrouter.ai/api/v1';
				case 'zhipu': return 'https://open.bigmodel.cn/api/paas/v4';
				case 'qwen': return 'https://dashscope.aliyuncas.com/compatible-mode/v1';
				case 'qianfan': return 'https://qianfan.baidubce.com/v2';
				case 'hunyuan': return 'https://api.hunyuan.cloud.tencent.com/v1';
				case 'volcengine': return 'https://ark.cn-beijing.volces.com/api/v3';
				case 'lingyi': return 'https://api.lingyiwanwu.com/v1';
				case 'minimax': return 'https://api.minimax.chat/v1';
				default: return '';
			}
		};

		const getDefaultModel = (provider) => {
			switch (provider) {
				case 'gemini': return 'gemini-3.5-flash';
				case 'claude': return 'claude-sonnet-4.5-20250929';
				case 'openai': return 'gpt-5-mini';
				case 'deepseek': return 'deepseek-v4-flash';
				case 'siliconflow': return 'deepseek-ai/DeepSeek-V3';
				case 'moonshot': return 'kimi-k2.6';
				case 'groq': return 'llama-3.3-70b-versatile';
				case 'openrouter': return 'google/gemini-2.0-flash-exp:free';
				case 'zhipu': return 'glm-5';
				case 'qwen': return 'qwen3.7-max';
				case 'qianfan': return 'ERNIE-4.0-Turbo-8K';
				case 'hunyuan': return 'hunyuan-standard';
				case 'volcengine': return 'Doubao-pro-32k';
				case 'lingyi': return 'yi-lightning';
				case 'minimax': return 'MiniMax-M2.7';
				default: return '';
			}
		};

		const getProviderDisplayName = (provider) => {
			switch (provider) {
				case 'gemini': return 'Google Gemini';
				case 'claude': return 'Anthropic Claude';
				case 'openai': return 'OpenAI';
				case 'deepseek': return 'DeepSeek';
				case 'siliconflow': return 'SiliconFlow';
				case 'moonshot': return 'Moonshot AI';
				case 'groq': return 'Groq';
				case 'openrouter': return 'OpenRouter';
				case 'zhipu': return '智谱清言';
				case 'qwen': return '通义千问';
				case 'qianfan': return '百度千帆';
				case 'hunyuan': return '腾讯混元';
				case 'volcengine': return '火山引擎';
				case 'lingyi': return '零一万物';
				case 'minimax': return 'MiniMax';
				case 'custom': return '自定义 OpenAI 兼容';
				default: return provider;
			}
		};

		const requestAnthropic = async (prompt, apiKey, baseUrl, model) => {
			const finalBaseUrl = baseUrl || 'https://api.anthropic.com';
			const normalizedUrl = finalBaseUrl.trim().replace(/\/$/, '');
			let url = normalizedUrl;
			if (!url.includes('/v1/messages')) {
				url = `${url}/v1/messages`;
			}

			const response = await fetch(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'x-api-key': apiKey,
					'anthropic-version': '2023-06-01',
					'dangerously-allow-browser': 'true'
				},
				body: JSON.stringify({
					model: model || 'claude-3-5-sonnet-20241022',
					messages: [
						{ role: 'user', content: prompt }
					],
					max_tokens: 1024
				})
			});

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				throw new Error(errorData.error?.message || `HTTP ${response.status}`);
			}

			const data = await response.json();
			const text = data?.content?.[0]?.text?.trim();
			if (!text) {
				throw new Error('AI 未返回有效内容');
			}
			return text;
		};

		const requestOpenAiCompatible = async (prompt, apiKey, baseUrl, model) => {
			if (!baseUrl) {
				throw new Error('API Base URL 不能为空');
			}
			const normalizedUrl = baseUrl.trim().replace(/\/$/, '');
			let url = normalizedUrl;
			if (!url.includes('/chat/completions')) {
				url = `${url}/chat/completions`;
			}
			
			const response = await fetch(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${apiKey}`
				},
				body: JSON.stringify({
					model: model,
					messages: [
						{ role: 'user', content: prompt }
					]
				})
			});

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				throw new Error(errorData.error?.message || `HTTP ${response.status}`);
			}

			const data = await response.json();
			const text = data?.choices?.[0]?.message?.content?.trim();
			if (!text) {
				throw new Error('AI 未返回有效内容');
			}
			return text;
		};

		const processAI = async (src, infos, looseness) => {
			if (isAiLoading) return; // 防止并发请求

			let aiConfigs = null;
			try {
				aiConfigs = JSON.parse(localStorage.getItem('AI_CONFIGS'));
			} catch (e) {
				console.error('读取 AI_CONFIGS 失败:', e);
			}

			if (!aiConfigs) {
				const oldKey = localStorage.getItem('GEMINI_API_KEY');
				const oldProxy = localStorage.getItem('GEMINI_PROXY') || '';
				if (oldKey) {
					aiConfigs = {
						activeProvider: 'gemini',
						providers: {
							gemini: { apiKey: oldKey, baseUrl: oldProxy, model: 'gemini-2.0-flash' }
						}
					};
				}
			}

			if (!aiConfigs) {
				alert('请先配置 AI 服务商与密钥');
				const aiSettingsModal = document.getElementById('aiSettingsModal');
				if (aiSettingsModal) {
					aiSettingsModal.classList.add('active');
					aiSettingsModal.setAttribute('aria-hidden', 'false');
				}
				return;
			}

			const provider = aiConfigs.activeProvider || 'gemini';
			const providerConf = aiConfigs.providers?.[provider] || {};
			const apiKey = providerConf.apiKey;
			const baseUrl = providerConf.baseUrl !== undefined ? providerConf.baseUrl : getDefaultBaseUrl(provider);
			const model = providerConf.model || getDefaultModel(provider);

			if (!apiKey) {
				alert(`请先配置 ${getProviderDisplayName(provider)} 的 API Key`);
				const aiSettingsModal = document.getElementById('aiSettingsModal');
				if (aiSettingsModal) {
					aiSettingsModal.classList.add('active');
					aiSettingsModal.setAttribute('aria-hidden', 'false');
				}
				return;
			}

			isAiLoading = true;

			const output = document.getElementById('output');
			const badges = document.getElementById('badges');
			const matchedResultsList = document.getElementById('matchedResultsList');
			
			output.innerHTML = '<i class="ri-robot-2-line"></i> AI 正在思考中...';
			badges.innerHTML = '<div class="badge"><i class="ri-time-line"></i> 请稍候</div>';
			matchedResultsList.innerHTML = '';

			const tier = getLoosenessTier(looseness);
			const mySearchId = currentSearchId; // 捕获当前的 SearchId
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
				let text;
				if (provider === 'gemini') {
					text = await requestGemini(prompt, apiKey, baseUrl, model);
				} else if (provider === 'claude') {
					text = await requestAnthropic(prompt, apiKey, baseUrl, model);
				} else {
					text = await requestOpenAiCompatible(prompt, apiKey, baseUrl, model);
				}
				
				// 任务过时检查
				if (mySearchId !== currentSearchId) return;

				// 只提取中文词条
				const rawWords = text.match(/[\u4e00-\u9fa5]+/g) || [];
				const aiWords = rawWords
					.map(w => w.trim())
					.filter(Boolean)
					.filter(w => w !== src);

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
					const errorMsg = e.message || '未知错误';
					const hint = getAiErrorHint(errorMsg);
					output.textContent = `❌ AI 生成失败：${errorMsg}。${hint}`;
					badges.innerHTML = '';
				} finally {
					isAiLoading = false; // 释放请求锁
					clearSlowQueryFeedback();
					setTimeout(() => {
						setGenerateButtonsLoading(false);
					}, 100);
				}
			};

		const testAiConnection = async () => {
			const statusEl = document.getElementById('aiTestStatus');
			const testBtn = document.getElementById('testAiSettings');
			
			const provider = document.getElementById('aiProvider')?.value;
			const apiKey = document.getElementById('aiApiKey')?.value.trim();
			const baseUrl = document.getElementById('aiBaseUrl')?.value.trim();
			const model = document.getElementById('aiModel')?.value.trim();
			
			if (!statusEl || !testBtn) return;

			if (!apiKey) {
				statusEl.textContent = '请先填写 API Key。';
				statusEl.dataset.type = 'error';
				return;
			}
			
			if (provider === 'custom' && !baseUrl) {
				statusEl.textContent = '自定义服务商必须填写 API Base URL。';
				statusEl.dataset.type = 'error';
				return;
			}

			statusEl.textContent = '正在测试连接...';
			statusEl.dataset.type = 'info';
			testBtn.disabled = true;
			try {
				const testPrompt = '请回复“连接成功”四个字。';
				let responseText;
				
				if (provider === 'gemini') {
					responseText = await requestGemini(testPrompt, apiKey, baseUrl, model || 'gemini-2.0-flash');
				} else if (provider === 'claude') {
					responseText = await requestAnthropic(testPrompt, apiKey, baseUrl, model || 'claude-3-5-sonnet-20241022');
				} else {
					const finalBaseUrl = baseUrl || getDefaultBaseUrl(provider);
					const finalModel = model || getDefaultModel(provider);
					responseText = await requestOpenAiCompatible(testPrompt, apiKey, finalBaseUrl, finalModel);
				}
				
				if (responseText && (responseText.includes('成功') || responseText.length > 0)) {
					statusEl.textContent = '连接成功，API 可用。';
					statusEl.dataset.type = 'success';
				} else {
					statusEl.textContent = '连接失败：未收到有效响应。';
					statusEl.dataset.type = 'error';
				}
			} catch (e) {
				const errorMsg = e.message || '未知错误';
				statusEl.textContent = `连接失败：${getAiErrorHint(errorMsg)} (${errorMsg})`;
				statusEl.dataset.type = 'error';
			} finally {
				testBtn.disabled = false;
			}
		};

		const setGenerateButtonsLoading = (loading) => {
			const buttons = [
				document.getElementById('go'),
				document.getElementById('goSticky')
			].filter(Boolean);

			buttons.forEach(btn => {
				if (loading) {
					btn.classList.add('loading');
					if (!btn.querySelector('.btn-text')) {
						btn.innerHTML = `<span class="btn-text">${btn.textContent}</span><span class="spinner"></span>`;
					}
				} else {
					btn.classList.remove('loading');
				}
			});
		};

		const process = async () => {
		// 每次启动搜索，增加 ID，立即使之前的异步任务失效
		const mySearchId = ++currentSearchId;
		scheduleSlowQueryFeedback(mySearchId);
		let delegatedToAi = false;

		// 立即清理任何正在进行的动画，防止新旧结果交替闪烁
		if (window.stopAllRhymeAnimations) {
			window.stopAllRhymeAnimations();
		}
		
		try {
			const src = document.getElementById('source').value.trim();
			const looseness = Number(document.getElementById('looseness').value);
			const isAiMode = document.getElementById('aiMode').checked;
			
			// Show loading state
			setGenerateButtonsLoading(true);
		
		if (!pinyinReady || !window.pinyinPro || !window.pinyinPro.pinyin) {
			setGenerateButtonsLoading(false);
			clearSlowQueryFeedback();
			render([], 'pinyin-pro 未加载，请检查网络或稍后重试', null, '');
			return;
		}
		if (bankMap.size === 0) bankMap = registerBank();
		if (!src) {
			setGenerateButtonsLoading(false);
			clearSlowQueryFeedback();
			render([], '等待输入...', null, '');
			return;
		}

		// 新增：限制单字查询，防止性能问题和无意义结果
		if (Array.from(src).length < 2) {
			setGenerateButtonsLoading(false);
			clearSlowQueryFeedback();
			render([], '<i class="ri-alert-fill" style="color:#f59e0b; margin-right:4px;"></i> 请输入至少两个字符以获得更精准的押韵结果。', null, '');
			return;
		}

		// 仅支持纯中文输入（本项目为中文韵脚查询）
		if (!isOnlyChinese(src)) {
			setGenerateButtonsLoading(false);
			clearSlowQueryFeedback();
			render([], '<i class="ri-alert-fill" style="color:#f59e0b; margin-right:4px;"></i> 仅支持纯中文词语查询，请勿包含字母、数字、空格或标点符号。', null, '');
			return;
		}
		addToHistory(src);
		renderQuickLists();

		// Build new infos but preserve locked/forced settings from previous run
			const oldInfos = Array.isArray(currentInfos) ? currentInfos.slice() : [];
			
			// 先提取所有字符的拼音信息，记录基准声调
			const tempInfos = Array.from(src).map((ch) => {
				const info = toInfo(ch);
				if (!info) return { char: ch, raw: '-', tone: '-', baseTone: '-', fin: '-', forcedTone: null, forcedFinal: null, forcedRaw: null };
				return { ...info, baseTone: info.tone, forcedTone: null, forcedFinal: null, forcedRaw: null };
			});

			// 应用用户在解析表中选择的强制声调 / 强制韵母 / 强制读音
			const tempInfosWithOverrides = tempInfos.map((info, idx) => {
				const old = oldInfos[idx];
				const forcedTone = old && old.forcedTone !== null ? old.forcedTone : null;
				const forcedFinal = old && old.forcedFinal !== undefined ? old.forcedFinal : null;
				const forcedRaw = old && old.forcedRaw !== undefined ? old.forcedRaw : null;
				const tone = forcedTone !== null ? forcedTone : info.baseTone;
				const fin = forcedFinal !== null ? forcedFinal : info.fin;
				const raw = forcedRaw !== null ? forcedRaw : info.raw;
				return { ...info, tone, fin, raw, forcedTone, forcedFinal, forcedRaw };
			});

			if (isAiMode) {
				delegatedToAi = true;
				clearSlowQueryFeedback();
				setQueryStatus('AI 正在生成押韵建议...');
				processAI(src, tempInfosWithOverrides, looseness);
				return;
			}
			
			// 获取用户输入的原词（用于排除）
			const userInput = tempInfosWithOverrides.map(info => info.char).join('');

			// 在开始新搜索前，清理旧的动画任务，防止新老任务交替闪烁
			if (window.stopAllRhymeAnimations) {
				window.stopAllRhymeAnimations();
			}

			// 增量渲染回调：在查询过程中就先显示一波结果
			let hasScrolled = false;
			const handleIncremental = (incResult) => {
				// 校验 ID，防止过时回调导致闪烁
				if (mySearchId !== currentSearchId) return;

				// 只要收到了增量更新（哪怕是空的精确匹配结果），就解除按钮转圈状态，让用户知道后台正在查
				setGenerateButtonsLoading(false);
				setQueryStatus('已找到部分结果，正在补充更多匹配...');

				if (incResult.sameLength.length > 0 || incResult.moreLengths.length > 0) {
					const firstPhrase = incResult.sameLength[0] || incResult.moreLengths[0] || src;
					const newInfos = tempInfosWithOverrides.map((info, idx) => {
						return { ...info, generated: Array.from(firstPhrase)[idx] || info.char, locked: false };
					});
					
					// 仅在第一波结果时触发滚动 (isIncremental = false)
					// 后续追加的结果不再强制滚动 (isIncremental = true)，避免干扰用户手动查看
					render(newInfos, firstPhrase, incResult, userInput, true, hasScrolled);
					hasScrolled = true;
				}
			};

			// 尝试从字典查询整句
			const dictResult = await queryDict(tempInfosWithOverrides, looseness, handleIncremental, mySearchId);
			
			// 如果在等待异步查询的过程中，任务已经过时，则不继续执行后续逻辑
			if (mySearchId !== currentSearchId) return;
			
			currentDictResult = dictResult; // 保存到全局变量供render使用
			
			if (dictResult) {
				devLog('字典查询成功');
				devLog('相同字数结果:', dictResult.sameLength);
				devLog('更长字数结果:', dictResult.moreLengths);
			}
			
			let newInfos;
			// 检查 dictResult 是否是多个候选项（字符串数组）
			if (dictResult && dictResult.sameLength && Array.isArray(dictResult.sameLength) && dictResult.sameLength.length > 0) {
				// 标记每个词的匹配等级并排序
				const matchesWithTier = dictResult.sameLength
					.map(phrase => ({ phrase, tier: getPhraseMatchTier(phrase, tempInfosWithOverrides, looseness) }))
					.filter(item => item.tier !== -1 && !item.phrase.includes(userInput));
				
				// 按等级排序 (0 < 1 < 2)，自定义词优先
				const customStr = localStorage.getItem('CUSTOM_RHYME_BANK');
				const customSet = new Set(customStr ? JSON.parse(customStr) : []);

				matchesWithTier.sort((a, b) => {
					const cleanA = a.phrase.endsWith('*') ? a.phrase.slice(0, -1) : a.phrase;
					const cleanB = b.phrase.endsWith('*') ? b.phrase.slice(0, -1) : b.phrase;
					const aIsCustom = customSet.has(cleanA);
					const bIsCustom = customSet.has(cleanB);
					if (aIsCustom && !bIsCustom) return -1;
					if (!aIsCustom && bIsCustom) return 1;
					return a.tier - b.tier;
				});
				const ranked = matchesWithTier.map(item => item.phrase);
				
				if (ranked.length === 0) {
					// 字典查询没有通过过滤的结果，退回到逐字选择的模式
					newInfos = tempInfosWithOverrides.map((info, idx) => {
						const oldState = oldInfos[idx] || {};
						if (info.fin === '-') {
							return {
								...info,
								generated: info.char,
								locked: false,
								forcedTone: oldState.forcedTone !== undefined ? oldState.forcedTone : null,
								forcedFinal: oldState.forcedFinal !== undefined ? oldState.forcedFinal : null,
								forcedRaw: oldState.forcedRaw !== undefined ? oldState.forcedRaw : null
							};
						}
						// 保留锁定状态
						if (oldInfos[idx] && oldInfos[idx].locked) {
							return { 
								...info, 
								generated: oldInfos[idx].generated || info.char, 
								locked: true, 
								forcedTone: oldState.forcedTone !== undefined ? oldState.forcedTone : null,
								forcedFinal: oldState.forcedFinal !== undefined ? oldState.forcedFinal : null,
								forcedRaw: oldState.forcedRaw !== undefined ? oldState.forcedRaw : null
							};
						}
						const candidate = pickFromMap(info.fin, info.tone, looseness);
						return { 
							...info, 
							generated: candidate || info.char, 
							locked: false, 
							forcedTone: oldState.forcedTone !== undefined ? oldState.forcedTone : null,
							forcedFinal: oldState.forcedFinal !== undefined ? oldState.forcedFinal : null,
							forcedRaw: oldState.forcedRaw !== undefined ? oldState.forcedRaw : null
						};
					});
				} else {
					const cleanPhraseStr = ranked[0].endsWith('*') ? ranked[0].slice(0, -1) : ranked[0];
					const firstPhrase = Array.from(cleanPhraseStr); // 第一条作为默认生成
					
					newInfos = tempInfosWithOverrides.map((info, idx) => {
						const oldState = oldInfos[idx] || {};
						// 保留锁定状态
						if (oldInfos[idx] && oldInfos[idx].locked) {
							return { 
								...info, 
								generated: oldInfos[idx].generated || info.char, 
								candidates: [], // 锁定状态下不显示候选项
								locked: true, 
								forcedTone: oldState.forcedTone !== undefined ? oldState.forcedTone : null,
								forcedFinal: oldState.forcedFinal !== undefined ? oldState.forcedFinal : null,
								forcedRaw: oldState.forcedRaw !== undefined ? oldState.forcedRaw : null
							};
						}
						
						// 为这个位置的所有候选词收集第 idx 个字符
						const charCandidates = [];
						for (const phrase of ranked) {
							const cleanPhrase = phrase.endsWith('*') ? phrase.slice(0, -1) : phrase;
							const chars = Array.from(cleanPhrase);
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
						forcedTone: oldState.forcedTone !== undefined ? oldState.forcedTone : null,
						forcedFinal: oldState.forcedFinal !== undefined ? oldState.forcedFinal : null,
						forcedRaw: oldState.forcedRaw !== undefined ? oldState.forcedRaw : null
					};
				});
			}
		} else {
			// 字典查询失败,使用原逻辑
			newInfos = tempInfosWithOverrides.map((info, idx) => {
				const oldState = oldInfos[idx] || {};
				if (info.fin === '-') {
					return {
						...info,
						generated: info.char,
						locked: false,
						forcedTone: oldState.forcedTone !== undefined ? oldState.forcedTone : null,
						forcedFinal: oldState.forcedFinal !== undefined ? oldState.forcedFinal : null,
						forcedRaw: oldState.forcedRaw !== undefined ? oldState.forcedRaw : null
					};
				}
				// 保留锁定状态
				if (oldInfos[idx] && oldInfos[idx].locked) {
					return { 
						...info, 
						generated: oldInfos[idx].generated || info.char, 
						locked: true, 
						forcedTone: oldState.forcedTone !== undefined ? oldState.forcedTone : null,
						forcedFinal: oldState.forcedFinal !== undefined ? oldState.forcedFinal : null,
						forcedRaw: oldState.forcedRaw !== undefined ? oldState.forcedRaw : null
					};
				}
				const candidate = pickFromMap(info.fin, info.tone, looseness);
				return { 
					...info, 
					generated: candidate || info.char, 
					locked: false, 
					forcedTone: oldState.forcedTone !== undefined ? oldState.forcedTone : null,
					forcedFinal: oldState.forcedFinal !== undefined ? oldState.forcedFinal : null,
					forcedRaw: oldState.forcedRaw !== undefined ? oldState.forcedRaw : null
				};
			});
		}
		
			currentInfos = newInfos;
			// 最终渲染所有结果 (若是增量模式则不应再触发滚动)
			render(currentInfos, currentInfos.map((i) => i.generated).join(''), currentDictResult, userInput, false, hasScrolled);
			clearSlowQueryFeedback();
		
		} catch (error) {
			console.error('执行失败:', error);
			clearSlowQueryFeedback();
		} finally {
			// 确保移除加载状态
			if (!delegatedToAi) {
				setTimeout(() => {
					setGenerateButtonsLoading(false);
				}, 100);
			}
		}
	};

	// 更新单个字符的声调或韵母
	const updateSingleChar = async (index, newTone, newFinal, newRaw = null) => {
		if (!Array.isArray(currentInfos) || index < 0 || index >= currentInfos.length) return;
		
		const mySearchId = ++currentSearchId; // 同样增加 ID
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

				// 更新拼音原文（用于多音字候选切换）
				if (newRaw !== null && newRaw !== undefined) {
					updated.forcedRaw = newRaw;
					updated.raw = newRaw;
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
		const dictResult = await queryDict(updatedInfos, looseness, null, mySearchId);
		
		if (mySearchId !== currentSearchId) return;

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

	const render = (infos, text, dictResult, userInput, skipFilter = false, isIncremental = false) => {
			// 获取平仄过滤选项
			const pingzeFilter = document.querySelector('input[name="pingze"]:checked')?.value || 'all';
			const looseness = Number(document.getElementById('looseness').value);
			
			// 更新右侧生成结果面板
			const output = document.getElementById('output');
			const badges = document.getElementById('badges');
			const noResultActions = document.getElementById('noResultActions');
			
			if (output) {
				// 获取所有待显示的匹配结果及其等级
				let resultsWithTier = [];
				
				// 1. 处理主结果 (text)
				if (text) {
					const cleanText = text.endsWith('*') ? text.slice(0, -1) : text;
					if (cleanText !== userInput) {
						resultsWithTier.push({ phrase: text, tier: getPhraseMatchTier(text, infos, looseness) });
					}
				}
				
				// 2. 处理字典中的其他相同字数结果
				if (dictResult && dictResult.sameLength && dictResult.sameLength.length > 0) {
					for (const phrase of dictResult.sameLength) {
						const cleanPhrase = phrase.endsWith('*') ? phrase.slice(0, -1) : phrase;
						if (cleanPhrase !== userInput && phrase !== text) {
							const tier = skipFilter ? 0 : getPhraseMatchTier(phrase, infos, looseness);
							if (tier !== -1) {
								if (!resultsWithTier.some(r => r.phrase === phrase)) {
									resultsWithTier.push({ phrase, tier });
								}
							}
						}
					}
				}
				
				// 3. 排序 (按等级 0 -> 1 -> 2)，自定义词优先
				const customStr = localStorage.getItem('CUSTOM_RHYME_BANK');
				const customSet = new Set(customStr ? JSON.parse(customStr) : []);

				resultsWithTier.sort((a, b) => {
					const cleanA = a.phrase.endsWith('*') ? a.phrase.slice(0, -1) : a.phrase;
					const cleanB = b.phrase.endsWith('*') ? b.phrase.slice(0, -1) : b.phrase;
					const aIsCustom = customSet.has(cleanA);
					const bIsCustom = customSet.has(cleanB);
					if (aIsCustom && !bIsCustom) return -1;
					if (!aIsCustom && bIsCustom) return 1;
					if (aIsCustom && bIsCustom) return a.tier - b.tier;
					
					// 歌词词优先
					const aIsLyric = a.phrase.endsWith('*');
					const bIsLyric = b.phrase.endsWith('*');
					if (aIsLyric && !bIsLyric) return -1;
					if (!aIsLyric && bIsLyric) return 1;
					
					return a.tier - b.tier;
				});

				// 4. 应用平仄过滤
				if (looseness >= 1.0 && pingzeFilter !== 'all') {
					resultsWithTier = resultsWithTier.filter(item => {
						const filtered = filterByPingZe([item.phrase], pingzeFilter);
						return filtered.length > 0;
					});
				}

				const hasMeaningfulResult = resultsWithTier.some(item => item.phrase && item.phrase !== userInput);
				if (noResultActions) {
					const isAiMode = document.getElementById('aiMode')?.checked;
					noResultActions.style.display = (!isAiMode && userInput && !hasMeaningfulResult) ? 'block' : 'none';
				}
				
				// 5. 渲染 HTML (支持颜色标注)
				
				// 停止可能存在的旧动画
				if (window.stopAllRhymeAnimations) window.stopAllRhymeAnimations();

				// 锁定当前高度，防止清空时塌陷
				if (output.offsetHeight > 0) {
					output.style.minHeight = output.offsetHeight + 'px';
				}

				output.innerHTML = '';
				resultsWithTier.forEach((item, idx) => {
					const span = document.createElement('span');
					let displayPhrase = item.phrase;
					let isLyric = false;
					if (item.phrase.endsWith('*')) {
						displayPhrase = item.phrase.slice(0, -1);
						isLyric = true;
					}
					span.textContent = displayPhrase;
					
					// 设置不同等级的颜色
					if (customSet.has(displayPhrase)) {
						span.style.color = '#4ade80'; // 自定义词：草绿色
						span.title = '自定义词库词汇';
					} else if (isLyric) {
						span.style.color = '#f472b6'; // 歌词词：淡粉色
						span.title = '歌词语料词汇';
					} else if (item.tier === 0) {
						span.style.color = '#d7c4ff'; // 严格：亮紫色
						span.title = '严格匹配 (同韵同调)';
					} else if (item.tier === 1) {
						span.style.color = '#baa8df'; // 中等：亮青色
						span.title = '中等匹配 (同调，韵母放宽)';
					} else {
						span.style.color = '#9e8cbe'; // 最松：亮灰色
						span.title = '最松匹配 (忽略声调)';
						span.style.opacity = '0.9';
					}

					output.appendChild(span);
					
					// 添加制表符分隔
					if (idx < resultsWithTier.length - 1) {
						output.appendChild(document.createTextNode('\t'));
					}
				});

				// 渲染完成后延迟释放高度限制，平滑过渡
				// requestAnimationFrame(() => {
				setTimeout(() => { 
					output.style.minHeight = ''; 
				}, 300);
				// });

				output.style.whiteSpace = 'pre-wrap';
				output.style.wordBreak = 'keep-all';
				output.style.overflowWrap = 'normal';
				output.style.fontFamily = 'var(--font-sans, "Inter", "Segoe UI", system-ui, -apple-system, sans-serif)';
				output.style.fontSize = '18px';
				output.style.fontWeight = '600';
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

			// 处理"更多匹配结果"（包含长词与短词/单字）
			const matchedResults = document.getElementById('matchedResults');
			const matchedResultsList = document.getElementById('matchedResultsList');
			
			if (matchedResultsList && matchedResults) {
				matchedResultsList.innerHTML = '';
				const moreMatches = [];
				
				// 收集比用户输入更长的词
				if (dictResult && dictResult.moreLengths && dictResult.moreLengths.length > 0) {
					moreMatches.push(...dictResult.moreLengths);
				}

				// 收集比用户输入更短的词（如单字）
				if (dictResult && dictResult.lessLength && dictResult.lessLength.length > 0) {
					moreMatches.push(...dictResult.lessLength);
				}

				// 过滤重复的词并进行一致性过滤
				let uniqueTailMatches = [];
				const seen = new Set();
				
				moreMatches.forEach(phrase => {
					if (!phrase || seen.has(phrase)) return;
					
					// 增加一致性过滤：确保匹配结果也符合韵脚规则
					const matchTier = getPhraseMatchTier(phrase, infos, looseness);
					if (matchTier === -1) return;
					
					// 在较低宽松度下，可以接受中等匹配及以上的结果
					const tierLimit = getLoosenessTier(looseness);
					if (matchTier > Math.min(tierLimit + 1, 2)) return;

					seen.add(phrase);
					uniqueTailMatches.push(phrase);
				});
				
				// 用户要求：更多匹配结果中，同长度且结尾2个字相同的词只能随机保留一个
				const groupedByLenAndTail = new Map();
				const shortMatches = [];
				uniqueTailMatches.forEach(phrase => {
					const cleanPhrase = phrase.endsWith('*') ? phrase.slice(0, -1) : phrase;
					if (cleanPhrase.length < 2) {
						shortMatches.push(phrase);
					} else {
						const tail = cleanPhrase.slice(-2);
						const groupKey = `${cleanPhrase.length}_${tail}`;
						if (!groupedByLenAndTail.has(groupKey)) {
							groupedByLenAndTail.set(groupKey, []);
						}
						groupedByLenAndTail.get(groupKey).push(phrase);
					}
				});
				
				const filteredMatches = [...shortMatches];
				groupedByLenAndTail.forEach((phrases) => {
					const randomIndex = Math.floor(Math.random() * phrases.length);
					filteredMatches.push(phrases[randomIndex]);
				});
				uniqueTailMatches = filteredMatches;
				
				// 按字数排序，自定义词优先
				const customStr = localStorage.getItem('CUSTOM_RHYME_BANK');
				const customSet = new Set(customStr ? JSON.parse(customStr) : []);

				uniqueTailMatches.sort((a, b) => {
					const cleanA = a.endsWith('*') ? a.slice(0, -1) : a;
					const cleanB = b.endsWith('*') ? b.slice(0, -1) : b;
					const aIsCustom = customSet.has(cleanA);
					const bIsCustom = customSet.has(cleanB);
					if (aIsCustom && !bIsCustom) return -1;
					if (!aIsCustom && bIsCustom) return 1;
					if (aIsCustom && bIsCustom) return cleanA.length - cleanB.length;
					
					// 歌词词优先
					const aIsLyric = a.endsWith('*');
					const bIsLyric = b.endsWith('*');
					if (aIsLyric && !bIsLyric) return -1;
					if (!aIsLyric && bIsLyric) return 1;
					
					return cleanA.length - cleanB.length;
				});

				matchedResultsList.innerHTML = '';
				matchedResultsList.className = 'match-grid';
				
				let hasContent = false;
				// 限制最多展示 200 个，防止 DOM 过多造成卡顿
				const displayMatches = uniqueTailMatches.slice(0, 200);

				displayMatches.forEach(phrase => {
					const cleanPhrase = phrase.endsWith('*') ? phrase.slice(0, -1) : phrase;
					if (phrase && cleanPhrase !== userInput) {
						const div = document.createElement('div');
						div.className = 'match-item';
						let displayPhrase = phrase;
						let isLyric = false;
						if (phrase.endsWith('*')) {
							displayPhrase = phrase.slice(0, -1);
							isLyric = true;
						}
						div.textContent = displayPhrase;
						div.dataset.length = displayPhrase.length;
						
						if (customSet.has(phrase)) {
							div.style.color = '#4ade80'; // 自定义词：草绿色
							div.style.borderColor = 'rgba(74, 222, 128, 0.4)';
							div.style.background = 'rgba(74, 222, 128, 0.08)';
							div.title = '自定义词库词汇';
						} else if (isLyric) {
							div.style.color = '#f472b6'; // 淡粉色
							div.style.borderColor = 'rgba(244, 114, 182, 0.4)';
							div.style.background = 'rgba(244, 114, 182, 0.08)';
							div.title = '歌词语料词汇';
						}
						div.addEventListener('click', () => {
							document.getElementById('source').value = displayPhrase;
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
				td1.setAttribute('data-label', '原字');
				tr.appendChild(td1);
				
				// 第二列：拼音
				const td2 = document.createElement('td');
				td2.setAttribute('data-label', '拼音');
				const pinyinText = document.createElement('div');
				pinyinText.className = 'raw-pinyin';
				pinyinText.textContent = i.raw || '-';
				td2.appendChild(pinyinText);

				const polyphonicOptions = getPolyphonicCandidates(i.char);
				if (polyphonicOptions.length > 1) {
					const polyphoneSelect = document.createElement('select');
					polyphoneSelect.className = 'polyphone-select';
					polyphoneSelect.dataset.index = index;

					polyphonicOptions.forEach((option, optionIndex) => {
						const opt = document.createElement('option');
						opt.value = String(optionIndex);
						opt.textContent = `${option.raw}`;
						const sameRaw = option.raw === i.raw;
						const sameTone = Number(option.tone) === Number(i.tone);
						const sameFinal = option.fin === i.fin;
						opt.selected = sameRaw && sameTone && sameFinal;
						polyphoneSelect.appendChild(opt);
					});

					polyphoneSelect.addEventListener('change', (e) => {
						const idx = Number(e.target.dataset.index);
						const selected = polyphonicOptions[Number(e.target.value)];
						if (!selected) return;
						updateSingleChar(idx, selected.tone, selected.fin, selected.raw);
					});

					td2.appendChild(polyphoneSelect);
				}
				tr.appendChild(td2);
				
				// 第三列：声调
				const td3 = document.createElement('td');
				td3.textContent = i.tone || '-';
				td3.setAttribute('data-label', '声调');
				tr.appendChild(td3);
				
				// 第四列：韵母+声调控制
				const td4 = document.createElement('td');
				td4.setAttribute('data-label', '选择韵母');
				
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
			if (window.triggerResultAnimation) window.triggerResultAnimation(isIncremental);
		};


		// Debounce 函数
		const debounce = (func, delay) => {
			let timeoutId;
			return (...args) => {
				clearTimeout(timeoutId);
				timeoutId = setTimeout(() => func(...args), delay);
			};
		};

		const renderQuickLists = () => {
			const sourceInput = document.getElementById('source');
			const historyListEl = document.getElementById('historyList');
			if (!sourceInput || !historyListEl) return;

			historyListEl.innerHTML = '';
			const items = readList(HISTORY_KEY).slice(0, MAX_HISTORY);
			if (!items.length) {
				const empty = document.createElement('div');
				empty.className = 'history-empty';
				empty.textContent = '暂无历史查询';
				historyListEl.appendChild(empty);
				return;
			}

			items.forEach((item, index) => {
				const btn = document.createElement('button');
				btn.type = 'button';
				btn.className = 'history-item';
				btn.title = '点击快速查询';
				const indexSpan = document.createElement('span');
				indexSpan.className = 'history-index';
				indexSpan.textContent = `${index + 1}.`;
				const textSpan = document.createElement('span');
				textSpan.className = 'history-text';
				textSpan.textContent = item;
				btn.append(indexSpan, textSpan);
				btn.addEventListener('click', () => {
					sourceInput.value = item;
					if (window.handleClearBtnVisibility) {
						window.handleClearBtnVisibility();
					}
					sourceInput.blur();
					process();
				});
				historyListEl.appendChild(btn);
			});
		};

		const init = () => {
			const goBtn = document.getElementById('go');
			goBtn.addEventListener('click', () => {
				if (window.isDictLoading) return;
				if (!window.dictLoaded) {
					loadDict();
				} else {
					process();
				}
			});
			const goStickyBtn = document.getElementById('goSticky');
			if (goStickyBtn) {
				goStickyBtn.addEventListener('click', () => {
					if (window.isDictLoading) return;
					if (!window.dictLoaded) {
						loadDict();
					} else {
						const source = document.getElementById('source');
						if (source) source.blur();
						process();
					}
				});
			}
			const sourceInput = document.getElementById('source');
			
			// 当输入框内容变化时，清除加载状态
			sourceInput.addEventListener('input', () => {
				setGenerateButtonsLoading(false);
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
			const setLoosenessSelection = (value) => {
				const target = String(value);
				segmentBtns.forEach(b => b.classList.toggle('active', b.dataset.value === target));
				loosenInput.value = target;
			};
			
			// 监听分段选择器点击
			segmentBtns.forEach(btn => {
				btn.addEventListener('click', () => {
					setLoosenessSelection(btn.dataset.value);
					
					// 触发更新（使用防抖，避免 AI 模式下快速切换触发多次 API 请求）
					updatePingzeFilterVisibility();
					debouncedRecalc();
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

			const noResultActions = document.getElementById('noResultActions');
			if (noResultActions) {
				noResultActions.addEventListener('click', (e) => {
					const target = e.target.closest('button[data-action]');
					if (!target) return;
					const action = target.dataset.action;
					const src = sourceInput.value.trim();
					if (!src) return;

					if (action === 'to-medium') {
						setLoosenessSelection('0.5');
					} else if (action === 'to-loose') {
						setLoosenessSelection('1');
					} else if (action === 'tail-only') {
						const chars = Array.from(src);
						if (chars.length > 2) {
							sourceInput.value = chars.slice(-2).join('');
						}
						setLoosenessSelection('1');
					}
					updatePingzeFilterVisibility();
					process();
				});
			}

			// loadDictBtn 已移除，加载词库功能已复用 go 按钮

			const clearHistoryBtn = document.getElementById('clearHistoryBtn');
			if (clearHistoryBtn) {
				clearHistoryBtn.addEventListener('click', () => {
					writeList(HISTORY_KEY, []);
					renderQuickLists();
				});
			}

			const clearDictBtn = document.getElementById('clearDictBtn');
			clearDictBtn.addEventListener('click', () => {
				if (!confirm('确定要清理本地缓存的词库数据吗？清理后需要重新加载词库才能正常使用。')) return;
				
				const originalText = clearDictBtn.innerHTML;
				clearDictBtn.innerHTML = '<i class="ri-loader-4-line"></i> 清理中...';
				clearDictBtn.disabled = true;

				const handleClearCacheComplete = async () => {
					// 关闭并清理 SQLite 数据库连接
					if (window.dbManager && window.dbManager.reset) {
						window.dbManager.reset();
					}

					// 清理 IndexedDB
					try {
						// 清理旧的 DB (如果存在)
						try { indexedDB.deleteDatabase('FakerRhymesDB'); } catch(e) {}
						
						// 清理新的 SQLite DB 和 原生 IndexedDB
						const deleteRequest = indexedDB.deleteDatabase('RhymeSQLiteDB');
						deleteRequest.onsuccess = () => {
							console.log('SQLite IndexedDB 清理成功');
						};
						try {
							const deleteReq2 = indexedDB.deleteDatabase('RhymeIndexedDB_v2');
							deleteReq2.onsuccess = () => console.log('原生 IndexedDB 清理成功');
						} catch(e) {}
					} catch (e) {
						console.warn('直接清理 IndexedDB 出错:', e);
					}

					// 新增：彻底清理 Service Worker 和 Cache Storage
					try {
						if ('caches' in window) {
							const cacheNames = await caches.keys();
							await Promise.all(cacheNames.map(name => caches.delete(name)));
							console.log('Cache Storage 清理完成');
						}
						
						if ('serviceWorker' in navigator) {
							const registrations = await navigator.serviceWorker.getRegistrations();
							for (let reg of registrations) {
								await reg.unregister();
							}
							console.log('Service Worker 已注销');
						}
					} catch (e) {
						console.warn('清理 Service Worker 缓存出错:', e);
					}

					localStorage.removeItem('ONLINE_DICT_TIME');
					localStorage.removeItem('ONLINE_DICT_COUNT');
					localStorage.removeItem('ONLINE_DICT_CACHE');
					localStorage.removeItem('ONLINE_DICT_STATS');
					localStorage.removeItem('ONLINE_DICT_SOURCE');
					
					window.dictLoaded = false;
					globalDictData = null; // 同时清理内存数据
					setDictLoadStatus('所有缓存已彻底清理，请重新加载。', 'info');
					
					clearDictBtn.innerHTML = '<i class="ri-check-line"></i> 已清理';
					updateDictStatus();
					
					// 恢复按钮状态以便再次加载
// loadDictBtn removed

					setTimeout(() => {
						clearDictBtn.innerHTML = originalText;
						clearDictBtn.disabled = false;
						// 强制加上时间戳参数刷新页面，彻底摆脱由于 URL 相同导致的浏览器 HTTP 强缓存
						const ts = new Date().getTime();
						window.location.href = window.location.pathname + '?clear=' + ts;
					}, 1500);
				};

				// 由于移除了 Worker 缓存，直接清理本地存储和 IndexedDB
				handleClearCacheComplete();
			});

			// AI Mode Logic
			const aiModeCheckbox = document.getElementById('aiMode');
			const dictWarning = document.getElementById('dictWarning');
			const aiSettingsModal = document.getElementById('aiSettingsModal');
			const openAiSettingsBtn = document.getElementById('openAiSettings');
			const closeAiSettingsBtn = document.getElementById('closeAiSettings');
			const saveAiSettingsBtn = document.getElementById('saveAiSettings');
			const testAiSettingsBtn = document.getElementById('testAiSettings');
			const aiTestStatus = document.getElementById('aiTestStatus');
			
			// 新增表单项
			const aiProviderSelect = document.getElementById('aiProvider');
			const aiApiKeyInput = document.getElementById('aiApiKey');
			const aiApiKeyLabel = document.getElementById('aiApiKeyLabel');
			const aiKeyHint = document.getElementById('aiKeyHint');
			const aiKeyLink = document.getElementById('aiKeyLink');
			const aiBaseUrlInput = document.getElementById('aiBaseUrl');
			const aiBaseUrlLabel = document.getElementById('aiBaseUrlLabel');
			const aiBaseUrlHint = document.getElementById('aiBaseUrlHint');
			const aiModelInput = document.getElementById('aiModel');
			const aiModelSelect = document.getElementById('aiModelSelect');

			// 初始化并做兼容性迁移
			let aiConfigs = null;
			try {
				aiConfigs = JSON.parse(localStorage.getItem('AI_CONFIGS'));
			} catch (e) {}

			if (!aiConfigs) {
				const oldKey = localStorage.getItem('GEMINI_API_KEY') || '';
				const oldProxy = localStorage.getItem('GEMINI_PROXY') || '';
				aiConfigs = {
					activeProvider: 'gemini',
					providers: {
						gemini: { apiKey: oldKey, baseUrl: oldProxy, model: 'gemini-3.5-flash' },
						claude: { apiKey: '', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4.5-20250929' },
						openai: { apiKey: '', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5-mini' },
						deepseek: { apiKey: '', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash' },
						siliconflow: { apiKey: '', baseUrl: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3' },
						moonshot: { apiKey: '', baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k2.6' },
						groq: { apiKey: '', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
						openrouter: { apiKey: '', baseUrl: 'https://openrouter.ai/api/v1', model: 'google/gemini-2.0-flash-exp:free' },
						zhipu: { apiKey: '', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-5' },
						qwen: { apiKey: '', baseUrl: 'https://dashscope.aliyuncas.com/compatible-mode/v1', model: 'qwen3.7-max' },
						qianfan: { apiKey: '', baseUrl: 'https://qianfan.baidubce.com/v2', model: 'ERNIE-4.0-Turbo-8K' },
						hunyuan: { apiKey: '', baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1', model: 'hunyuan-standard' },
						volcengine: { apiKey: '', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'Doubao-pro-32k' },
						lingyi: { apiKey: '', baseUrl: 'https://api.lingyiwanwu.com/v1', model: 'yi-lightning' },
						minimax: { apiKey: '', baseUrl: 'https://api.minimax.chat/v1', model: 'MiniMax-M2.7' },
						custom: { apiKey: '', baseUrl: '', model: '' }
					}
				};
				localStorage.setItem('AI_CONFIGS', JSON.stringify(aiConfigs));
			}

			// 补充缺失的服务商
			const defaultProviders = [
				'gemini', 'claude', 'openai', 'deepseek', 'siliconflow', 'moonshot',
				'groq', 'openrouter', 'zhipu', 'qwen', 'qianfan', 'hunyuan',
				'volcengine', 'lingyi', 'minimax', 'custom'
			];
			if (!aiConfigs.providers) aiConfigs.providers = {};
			defaultProviders.forEach(p => {
				if (!aiConfigs.providers[p]) {
					aiConfigs.providers[p] = {
						apiKey: '',
						baseUrl: getDefaultBaseUrl(p),
						model: getDefaultModel(p)
					};
				}
			});

			// 将模型列表更新及页面标签切换封装成函数
			const updateProviderUI = (provider) => {
				const conf = aiConfigs.providers[provider] || {};
				
				// 填充输入框值
				aiApiKeyInput.value = conf.apiKey || '';
				aiBaseUrlInput.value = conf.baseUrl !== undefined ? conf.baseUrl : getDefaultBaseUrl(provider);
				aiModelInput.value = conf.model || getDefaultModel(provider);
				
				// 修改 Label & Placeholder & Hint & Key 链接
				let keyLabel = 'API Key';
				let keyPlaceholder = '输入 API Key';
				let urlLabel = 'API Base URL (可选)';
				let urlPlaceholder = '请输入 API 接口地址';
				let urlHint = '可选，若为空则默认使用官方接口。';
				let showKeyHint = true;
				let keyHref = '';

				switch (provider) {
					case 'gemini':
						keyLabel = 'Gemini API Key';
						keyPlaceholder = '输入 Gemini API Key';
						urlLabel = 'API 代理地址 (可选)';
						urlPlaceholder = '例如: https://proxy.com';
						urlHint = '解决 Failed to fetch 错误。';
						keyHref = 'https://aistudio.google.com/app/apikey';
						break;
					case 'claude':
						keyLabel = 'Claude API Key';
						keyPlaceholder = '输入 Anthropic Claude API Key';
						urlLabel = 'API Base URL / 代理地址 (可选)';
						urlPlaceholder = '例如: https://api.anthropic.com';
						urlHint = '可选，直连时空着即可，也支持填入代理端点。';
						keyHref = 'https://console.anthropic.com/';
						break;
					case 'openai':
						keyLabel = 'OpenAI API Key';
						keyPlaceholder = '输入 OpenAI API Key';
						urlPlaceholder = '例如: https://api.openai.com/v1';
						keyHref = 'https://platform.openai.com/api-keys';
						break;
					case 'deepseek':
						keyLabel = 'DeepSeek API Key';
						keyPlaceholder = '输入 DeepSeek API Key';
						urlPlaceholder = '例如: https://api.deepseek.com';
						keyHref = 'https://platform.deepseek.com/api_keys';
						break;
					case 'siliconflow':
						keyLabel = 'SiliconFlow API Key';
						keyPlaceholder = '输入 SiliconFlow API Key';
						urlPlaceholder = '例如: https://api.siliconflow.cn/v1';
						keyHref = 'https://siliconflow.cn/zh-cn/';
						break;
					case 'moonshot':
						keyLabel = 'Moonshot API Key';
						keyPlaceholder = '输入 Moonshot API Key';
						urlPlaceholder = '例如: https://api.moonshot.cn/v1';
						keyHref = 'https://platform.moonshot.cn/console/api-keys';
						break;
					case 'groq':
						keyLabel = 'Groq API Key';
						keyPlaceholder = '输入 Groq API Key';
						urlPlaceholder = '例如: https://api.groq.com/openai/v1';
						keyHref = 'https://console.groq.com/keys';
						break;
					case 'openrouter':
						keyLabel = 'OpenRouter API Key';
						keyPlaceholder = '输入 OpenRouter API Key';
						urlPlaceholder = '例如: https://openrouter.ai/api/v1';
						keyHref = 'https://openrouter.ai/keys';
						break;
					case 'zhipu':
						keyLabel = '智谱 GLM API Key';
						keyPlaceholder = '输入智谱清言 API Key';
						urlPlaceholder = '例如: https://open.bigmodel.cn/api/paas/v4';
						keyHref = 'https://open.bigmodel.cn/';
						break;
					case 'qwen':
						keyLabel = 'DashScope API Key (通义千问)';
						keyPlaceholder = '输入阿里灵积 API Key';
						urlPlaceholder = '例如: https://dashscope.aliyuncas.com/compatible-mode/v1';
						keyHref = 'https://dashscope.console.aliyun.com/apiKey';
						break;
					case 'qianfan':
						keyLabel = '百度千帆 API Key';
						keyPlaceholder = '输入百度智能云千帆 API Key';
						urlPlaceholder = '例如: https://qianfan.baidubce.com/v2';
						keyHref = 'https://console.bce.baidu.com/qianfan/ais/console/applicationManage/application';
						break;
					case 'hunyuan':
						keyLabel = '腾讯混元 API Key';
						keyPlaceholder = '输入腾讯云混元 API Key';
						urlPlaceholder = '例如: https://api.hunyuan.cloud.tencent.com/v1';
						keyHref = 'https://console.cloud.tencent.com/hunyuan/api-key';
						break;
					case 'volcengine':
						keyLabel = '火山引擎 API Key (豆包)';
						keyPlaceholder = '输入字节跳动火山引擎 API Key';
						urlPlaceholder = '例如: https://ark.cn-beijing.volces.com/api/v3';
						keyHref = 'https://console.volcengine.com/ark/query/api_key';
						break;
					case 'lingyi':
						keyLabel = '零一万物 API Key';
						keyPlaceholder = '输入 01.AI API Key';
						urlPlaceholder = '例如: https://api.lingyiwanwu.com/v1';
						keyHref = 'https://platform.lingyiwanwu.com/apikeys';
						break;
					case 'minimax':
						keyLabel = 'MiniMax API Key';
						keyPlaceholder = '输入海螺大模型 API Key';
						urlPlaceholder = '例如: https://api.minimax.chat/v1';
						keyHref = 'https://platform.minimaxi.com/user-center/basic-information/interface-key';
						break;
					default:
						keyLabel = 'API Key';
						keyPlaceholder = '输入 API Key';
						urlLabel = 'API Base URL (必填)';
						urlPlaceholder = '例如: https://api.yourproxy.com/v1';
						urlHint = '自定义大模型厂商的 API 接口地址。';
						showKeyHint = false;
						break;
				}

				aiApiKeyLabel.textContent = keyLabel;
				aiApiKeyInput.placeholder = keyPlaceholder;
				aiBaseUrlLabel.textContent = urlLabel;
				aiBaseUrlInput.placeholder = urlPlaceholder;
				aiBaseUrlHint.textContent = urlHint;
				if (showKeyHint) {
					aiKeyHint.style.display = 'block';
					aiKeyLink.href = keyHref;
				} else {
					aiKeyHint.style.display = 'none';
				}

				// 动态更新 Datalist 模型名称
				let models = [];
				switch (provider) {
					case 'gemini':
						models = ['gemini-3.5-flash', 'gemini-3.1-pro-preview', 'gemini-3.1-flash-lite', 'gemini-2.5-pro', 'gemini-2.5-flash'];
						break;
					case 'claude':
						models = ['claude-opus-4.7', 'claude-opus-4.7-thinking', 'claude-sonnet-4.6', 'claude-sonnet-4.5-20250929', 'claude-haiku-4.5-20251001', 'claude-opus-4.5-20251101'];
						break;
					case 'openai':
						models = ['gpt-5.5-pro', 'gpt-5.5', 'gpt-5-pro', 'gpt-5', 'gpt-5-mini', 'o4-mini', 'gpt-4.1', 'gpt-4o', 'gpt-4o-mini'];
						break;
					case 'deepseek':
						models = ['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-r1', 'deepseek-v3.2', 'deepseek-v3'];
						break;
					case 'siliconflow':
						models = ['deepseek-ai/DeepSeek-V3', 'deepseek-ai/DeepSeek-R1', 'deepseek-ai/DeepSeek-R1-Distill-Llama-8B', 'deepseek-ai/DeepSeek-R1-Distill-Qwen-32B', 'Qwen/Qwen2.5-72B-Instruct', 'GLM-4-9B-Chat'];
						break;
					case 'moonshot':
						models = ['kimi-k2.6', 'kimi-k2.5', 'kimi-k2-250711', 'moonshot-v1-8k', 'moonshot-v1-32k'];
						break;
					case 'groq':
						models = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'];
						break;
					case 'openrouter':
						models = ['google/gemini-2.0-flash-exp:free', 'deepseek/deepseek-chat', 'anthropic/claude-3.5-sonnet', 'meta-llama/llama-3.3-70b-instruct'];
						break;
					case 'zhipu':
						models = ['glm-5.1', 'glm-5', 'glm-4.6', 'glm-4.5', 'glm-4-flash'];
						break;
					case 'qwen':
						models = ['qwen3.7-max', 'qwen-max', 'qwen-plus', 'qwen-turbo'];
						break;
					case 'qianfan':
						models = ['ERNIE-4.0-Turbo-8K', 'ERNIE-3.5-8K', 'ERNIE-Speed-128K', 'ERNIE-Lite-8K'];
						break;
					case 'hunyuan':
						models = ['hunyuan-lite', 'hunyuan-standard', 'hunyuan-pro'];
						break;
					case 'volcengine':
						models = ['Doubao-pro-32k', 'Doubao-pro-4k', 'Doubao-lite-4k'];
						break;
					case 'lingyi':
						models = ['yi-lightning', 'yi-large', 'yi-medium'];
						break;
					case 'minimax':
						models = ['MiniMax-M2.7', 'minimax-m2.5', 'abab6.5g-chat'];
						break;
				}

				if (aiModelSelect) {
					aiModelSelect.innerHTML = '';
					models.forEach(m => {
						const opt = document.createElement('option');
						opt.value = m;
						opt.textContent = m;
						opt.style.background = '#1e1e24';
						opt.style.color = 'var(--text)';
						aiModelSelect.appendChild(opt);
					});

					const customOpt = document.createElement('option');
					customOpt.value = 'custom_input';
					customOpt.textContent = '手动输入...';
					customOpt.style.background = '#1e1e24';
					customOpt.style.color = 'var(--text)';
					aiModelSelect.appendChild(customOpt);

					const savedModelVal = conf.model || getDefaultModel(provider);
					if (models.includes(savedModelVal)) {
						aiModelSelect.value = savedModelVal;
						aiModelInput.value = savedModelVal;
						aiModelInput.style.display = 'none';
					} else {
						aiModelSelect.value = 'custom_input';
						aiModelInput.value = savedModelVal;
						aiModelInput.style.display = 'block';
					}
				}
			};

			// Load saved AI settings
			const savedAiMode = localStorage.getItem('AI_MODE') === 'true';
			aiModeCheckbox.checked = savedAiMode;
			if (savedAiMode) {
				dictWarning.style.display = 'none';
			}

			// 初始化 Select 的选中状态
			if (aiProviderSelect) {
				aiProviderSelect.value = aiConfigs.activeProvider || 'gemini';
				updateProviderUI(aiProviderSelect.value);
				
				aiProviderSelect.addEventListener('change', (e) => {
					const prevProvider = aiConfigs.activeProvider;
					if (aiConfigs.providers[prevProvider]) {
						aiConfigs.providers[prevProvider].apiKey = aiApiKeyInput.value.trim();
						aiConfigs.providers[prevProvider].baseUrl = aiBaseUrlInput.value.trim();
						aiConfigs.providers[prevProvider].model = aiModelInput.value.trim();
					}
					
					aiConfigs.activeProvider = e.target.value;
					updateProviderUI(e.target.value);
				});
			}

			if (aiModelSelect) {
				aiModelSelect.addEventListener('change', (e) => {
					if (e.target.value === 'custom_input') {
						aiModelInput.style.display = 'block';
						if (aiModelInput.value === 'custom_input') {
							aiModelInput.value = '';
						}
					} else {
						aiModelInput.style.display = 'none';
						aiModelInput.value = e.target.value;
					}
				});
			}

			if (aiModelInput) {
				aiModelInput.addEventListener('input', (e) => {
					if (aiModelSelect && aiModelSelect.value !== 'custom_input') {
						aiModelSelect.value = 'custom_input';
					}
				});
			}

			aiModeCheckbox.addEventListener('change', (e) => {
				const isAi = e.target.checked;
				dictWarning.style.display = isAi ? 'none' : 'block';
				localStorage.setItem('AI_MODE', isAi);
				
				let keyExists = false;
				try {
					const configs = JSON.parse(localStorage.getItem('AI_CONFIGS'));
					const active = configs.activeProvider;
					if (configs.providers?.[active]?.apiKey) {
						keyExists = true;
					}
				} catch (err) {}
				
				if (!keyExists) {
					keyExists = !!localStorage.getItem('GEMINI_API_KEY');
				}
				
				if (isAi && !keyExists) {
					aiSettingsModal.classList.add('active');
					aiSettingsModal.setAttribute('aria-hidden', 'false');
				}
			});

			// Modal Logic
			openAiSettingsBtn.addEventListener('click', () => {
				aiSettingsModal.classList.add('active');
				aiSettingsModal.setAttribute('aria-hidden', 'false');
				if (aiTestStatus) {
					aiTestStatus.textContent = '';
				}
				if (aiProviderSelect) {
					aiProviderSelect.value = aiConfigs.activeProvider || 'gemini';
					updateProviderUI(aiProviderSelect.value);
				}
			});

			const closeModal = () => {
				aiSettingsModal.classList.remove('active');
				aiSettingsModal.setAttribute('aria-hidden', 'true');
			};

			closeAiSettingsBtn.addEventListener('click', closeModal);
			aiSettingsModal.addEventListener('click', (e) => {
				if (e.target === aiSettingsModal) closeModal();
			});

			saveAiSettingsBtn.addEventListener('click', () => {
				const provider = aiProviderSelect ? aiProviderSelect.value : 'gemini';
				aiConfigs.activeProvider = provider;
				
				if (!aiConfigs.providers[provider]) {
					aiConfigs.providers[provider] = {};
				}
				aiConfigs.providers[provider].apiKey = aiApiKeyInput.value.trim();
				aiConfigs.providers[provider].baseUrl = aiBaseUrlInput.value.trim();
				aiConfigs.providers[provider].model = aiModelInput.value.trim();
				
				localStorage.setItem('AI_CONFIGS', JSON.stringify(aiConfigs));
				
				if (provider === 'gemini') {
					localStorage.setItem('GEMINI_API_KEY', aiConfigs.providers.gemini.apiKey);
					localStorage.setItem('GEMINI_PROXY', aiConfigs.providers.gemini.baseUrl);
				}

				if (aiTestStatus) {
					aiTestStatus.textContent = '设置已保存。';
					aiTestStatus.dataset.type = 'success';
				}
				closeModal();
			});

			if (testAiSettingsBtn) {
				testAiSettingsBtn.addEventListener('click', testAiConnection);
			}

			updateDictStatus();
			renderQuickLists();

			// Expose debug utilities to window for console access
			window.dictDebug = {
				showStats: function() {
					const stats = localStorage.getItem('ONLINE_DICT_STATS');
					const cache = localStorage.getItem('ONLINE_DICT_CACHE');
					const lyricCount = localStorage.getItem('ONLINE_DICT_LYRIC_COUNT') || '?';
					const time = localStorage.getItem('ONLINE_DICT_TIME');
					
					console.clear();
					console.log('%c词库统计信息', 'font-size:16px; font-weight:bold; color:#7c3aed');
					const totalCount = localStorage.getItem('ONLINE_DICT_COUNT') || '?';
					console.log('总词数:', Number(totalCount).toLocaleString ? Number(totalCount).toLocaleString() : totalCount);
					console.log('歌词词数:', Number(lyricCount).toLocaleString ? Number(lyricCount).toLocaleString() : lyricCount);
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

			// 一键清空输入框逻辑
			const clearSourceBtn = document.getElementById('clearSourceBtn');
			const handleClearBtnVisibility = () => {
				if (clearSourceBtn) {
					if (sourceInput.value.length > 0) {
						clearSourceBtn.classList.add('show');
					} else {
						clearSourceBtn.classList.remove('show');
					}
				}
			};

			window.handleClearBtnVisibility = handleClearBtnVisibility;
			sourceInput.addEventListener('input', handleClearBtnVisibility);
			// 首次载入或重置时检测
			handleClearBtnVisibility();

			if (clearSourceBtn) {
				clearSourceBtn.addEventListener('click', () => {
					sourceInput.value = '';
					clearSourceBtn.classList.remove('show');
					
					// 清空详情调音列表
					const body = document.getElementById('detailBody');
					if (body) body.innerHTML = '';
					
					// 清空押韵展示
					const output = document.getElementById('output');
					if (output) output.innerHTML = '';
					
					// 隐藏降级及提示框
					const noResultActions = document.getElementById('noResultActions');
					if (noResultActions) noResultActions.style.display = 'none';
					const matchedResults = document.getElementById('matchedResults');
					if (matchedResults) matchedResults.style.display = 'none';
					
					// 重设缓存结果
					currentDictResult = null;
					
					// 停止并清理动画
					if (window.stopAllRhymeAnimations) {
						window.stopAllRhymeAnimations();
					}
					
					sourceInput.focus();
				});
			}

			// 启动页面基础动画
			if (window.startMainAnimations) {
				window.startMainAnimations();
			}
		};

		init();
