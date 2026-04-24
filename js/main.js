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
		// 编码版本历史:
		//   v1 (隐含): 'ü':'B', 'üan':'C', 'ün':'D' — 但 detectFinal 输出 v/van/vn，导致字典导入与查询编码不一致
		//   v2: 'ü':'y' — 与 'v':'y' 一致，修复 ü 编码
		//   v3 (当前): 新增 'van':'B' 映射（修复 üan 缺失编码），移除 legacyKeyMap 旧键扩展
		const DICT_ENCODING_VERSION = '3';
		const finalToCode = {
			'iong': '0', 'uang': '1', 'iang': '2', 'ueng': '3', 'uan': '4', 'ian': '5', 'uen': '6', 'iao': '7', 'uai': '8',
			'ang': '9', 'eng': 'a', 'ing': 'b', 'ong': 'c', 'ai': 'd', 'ei': 'e', 'ao': 'f', 'ou': 'g', 'an': 'h', 'en': 'i',
			'in': 'j', 'un': 'k', 'vn': 'l', 'ia': 'm', 'ua': 'n', 'uo': 'o', 'ie': 'p', 'ue': 'q', 'ui': 'r', 'er': 's',
			'a': 't', 'o': 'u', 'e': 'v', 'i': 'w', 'u': 'x', 'v': 'y', 'van': 'B', 'i-flat': 'z', 'i-retro': 'A', 'ü': 'y'
		};

		function encodeKey(key) {
			if (!key) return key;
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

		// 全局词库对象，用于快速内存查询
		let globalDictData = null;

		// 加载优化字典（拆分为3个文件）
		const loadDict = async () => {
			if (window.isDictLoading) return;
			window.isDictLoading = true;
			setDictLoadStatus('正在准备词库...');
			setTopProgress(0);

			const btn = document.getElementById('loadDictBtn');
			const originalBtnText = btn ? btn.innerHTML : '📚 加载词库';
			
			if (btn) {
				btn.disabled = true;
				btn.innerHTML = '<i class="ri-loader-4-line"></i> 准备中...';
			}

			try {
				// 尝试初始化数据库，如果已存在则不需要加载 JSON
				try {
					const db = await window.dbManager.init();

					// 编码版本迁移：检测 DICT_ENCODING_VERSION 变化，不一致时清空旧库强制重导
					// v1 从未保存版本号，因此 storedVersion 为 null 时也需要迁移（若有旧数据）
					const storedVersion = localStorage.getItem('DICT_ENCODING_VERSION');
					const needMigration = storedVersion !== DICT_ENCODING_VERSION;
					if (needMigration && await window.dbManager.checkDataExists()) {
						devLog(`字典编码版本变更 (v${storedVersion || '1'} → v${DICT_ENCODING_VERSION})，清空旧数据重新导入...`);
						setDictLoadStatus('检测到词库编码更新，正在重建...');
						window.dbManager.reset();
						try {
							await new Promise((resolve, reject) => {
								const deleteReq = indexedDB.deleteDatabase('RhymeSQLiteDB');
								deleteReq.onsuccess = resolve;
								deleteReq.onerror = reject;
								deleteReq.onblocked = resolve;
							});
						} catch(e) { console.warn('删除旧 IndexedDB 失败:', e); }
						await window.dbManager.init();
						devLog('旧数据库已清空，准备重新导入');
					}

					if (await window.dbManager.checkDataExists()) {
						devLog('SQLite 数据库已准备就绪，跳过 JSON 加载');
						window.dictLoaded = true;
						window.isDictLoading = false;
						localStorage.setItem('ONLINE_DICT_TIME', String(Date.now()));
						localStorage.setItem('ONLINE_DICT_COUNT', '7000+');
						localStorage.setItem('ONLINE_DICT_SOURCE', 'SQLite 本地词库');
						localStorage.setItem('DICT_ENCODING_VERSION', DICT_ENCODING_VERSION);
						setDictLoadStatus('词库已就绪，可离线使用。', 'success');
						setTopProgress(100);
						setTimeout(() => {
							const bar = document.getElementById('topProgressBar');
							if (bar) bar.classList.add('complete');
						}, 800);
						
						if (btn) btn.style.display = 'none';
						
						const warning = document.getElementById('dictWarning');
						if (warning) {
							warning.innerHTML = '<i class="ri-checkbox-circle-fill" style="margin-right:2px;"></i> 词库已就绪 (SQLite)';
							warning.style.color = '#10b981';
							warning.style.display = 'block';
						}
						return;
					}
				} catch (e) {
					console.warn('SQLite 初始化检查失败，回退到 JSON 加载:', e);
				}

				// 极致优化：不再写入 IndexedDB（写入太慢），直接将整个 JSON 载入内存
				// 拆分成3个文件以提升加载性能
				
				const startTime = performance.now();

				const files = [
					{ url: './dict_part_1.json', size: 13297393 },
					{ url: './dict_part_2.json', size: 14388764 },
					{ url: './dict_part_3.json', size: 12302875 }
				];
				
				const totalSize = files.reduce((acc, f) => acc + f.size, 0);
				let loadedSize = 0;
				const progressMap = new Array(files.length).fill(0);

				const updateProgress = () => {
					if (!btn) return;
					const currentLoaded = progressMap.reduce((acc, val) => acc + val, 0);
					const percent = Math.min(99, Math.round((currentLoaded / totalSize) * 100));
					btn.innerHTML = `<i class="ri-loader-4-line"></i> 载入中 ${percent}%`;
				};

				const fetchWithProgress = async (url, index) => {
					const response = await fetch(url);
					if (!response.ok) throw new Error(`加载失败: ${url}`);
					
					const reader = response.body.getReader();
					const contentLength = +response.headers.get('Content-Length') || files[index].size;
					
					// 如果服务器返回了 Content-Length，可以用它来校准
					if (contentLength && contentLength !== files[index].size) {
						// 动态调整 (这里简单处理，尽量依赖预设值)
					}

					const chunks = [];
					let receivedLength = 0;

					while (true) {
						const { done, value } = await reader.read();
						if (done) break;
						chunks.push(value);
						receivedLength += value.length;
						progressMap[index] = receivedLength;
						updateProgress();
					}

					const blob = new Blob(chunks);
					const text = await blob.text();
					return JSON.parse(text);
				};
				
				const fetchAndParse = async (fileInfo, index) => {
					const response = await fetch(fileInfo.url);
					if (!response.ok) throw new Error(`加载失败: ${fileInfo.url}`);
					
					const contentLength = +response.headers.get('Content-Length') || fileInfo.size;
					const reader = response.body.getReader();
					
					let receivedLength = 0;
					const chunks = [];
					
					while(true) {
						const {done, value} = await reader.read();
						if (done) break;
						chunks.push(value);
						receivedLength += value.length;
						progressMap[index] = receivedLength;
						
						// 更新总进度
						const currentLoaded = progressMap.reduce((acc, val) => acc + val, 0);
						const percent = Math.min(99, Math.round((currentLoaded / totalSize) * 100));
						if (btn) btn.innerHTML = `<i class="ri-loader-4-line"></i> 载入中 ${percent}%`;
						setDictLoadStatus(`下载词库中 ${percent}%`);
						setTopProgress(percent * 0.45);
					}
					
					const blob = new Blob(chunks);
					const text = await blob.text();
					return JSON.parse(text);
				};
				
				// 并行加载3个拆分文件
				const datasets = await Promise.all([
					fetchAndParse(files[0], 0),
					fetchAndParse(files[1], 1),
					fetchAndParse(files[2], 2)
				]);
				
				if (btn) btn.innerHTML = '<i class="ri-loader-4-line"></i> 解析中...';
				setDictLoadStatus('词库下载完成，正在解析...');
				setTopProgress(48);

				// 初始化 SQLite 数据库
				const db = await window.dbManager.init();
				
				// 检查是否需要导入数据
				if (!(await window.dbManager.checkDataExists())) {
					devLog('开始导入数据到 SQLite...');
					
					let batchData = [];
					let processedCount = 0;
					const CHUNK_SIZE = 2000; // 降低批处理大小 (10k -> 2k)，防止长时间占用主线程
					
					for (let i = 0; i < datasets.length; i++) {
						const dataset = datasets[i];
						if (!dataset) continue;
						
						const keys = Object.keys(dataset);
						
						for (let j = 0; j < keys.length; j++) {
							const key = keys[j];
							const encoded = encodeKey(key);
							const suffix = encoded.length >= 2 ? encoded.slice(-2) : '';
							
							if (Array.isArray(dataset[key])) {
								for (const phrase of dataset[key]) {
									batchData.push({
										phrase: phrase,
										length: phrase.length,
										encoded_key: encoded,
										suffix_2: suffix
									});
								}
							}
							
							// 分批插入，避免阻塞主线程
							if (batchData.length >= CHUNK_SIZE) {
								await window.dbManager.insertChunk(batchData);
								processedCount += batchData.length;
								batchData = [];
								
								// 每次 chunk 插入后都更新 UI 并让出主线程，不再跳过
								const importPercent = (i * 33 + (j / keys.length) * 33).toFixed(0);
								if (btn) btn.innerHTML = `<i class="ri-database-2-line"></i> 导入中 ${importPercent}%...`;
								setDictLoadStatus(`写入本地数据库中 ${importPercent}%`);
								setTopProgress(50 + Number(importPercent) * 0.40);
								
								// 增加延时 (0ms -> 5ms)，确保浏览器有足够时间渲染帧
								await new Promise(resolve => setTimeout(resolve, 5));
							}
						}
						
						// 显式释放内存
						datasets[i] = null;
					}
					
					// 插入剩余数据
					if (batchData.length > 0) {
						await window.dbManager.insertChunk(batchData);
						processedCount += batchData.length;
					}
					
					// 显式保存到 IndexedDB
					if (btn) btn.innerHTML = '<i class="ri-save-3-line"></i> 正在写入硬盘...';
					setDictLoadStatus('正在写入浏览器本地存储...');
					setTopProgress(93);
					await new Promise(resolve => setTimeout(resolve, 50)); 
					
					// 强制在下一次事件循环中执行 save，防止卡死当前渲染帧
					await new Promise(async (resolve) => {
						try {
							await window.dbManager.save();
						} catch(e) { console.error(e); }
						resolve();
					});
					
					devLog(`已导入 ${processedCount} 条数据到 SQLite`);
				} else {
					devLog('SQLite 数据库已存在数据，跳过导入');
				}
				
				window.dictLoaded = true;
				window.isDictLoading = false;
				localStorage.setItem('ONLINE_DICT_TIME', String(Date.now()));
				localStorage.setItem('ONLINE_DICT_COUNT', '7000+');
				localStorage.setItem('ONLINE_DICT_SOURCE', 'SQLite 本地词库');
				localStorage.setItem('DICT_ENCODING_VERSION', DICT_ENCODING_VERSION);
				setDictLoadStatus('词库加载完成，后续可离线使用。', 'success');
				devLog('词库就绪耗时:', (performance.now() - startTime).toFixed(2), 'ms');
				setTopProgress(100);
				setTimeout(() => {
					const bar = document.getElementById('topProgressBar');
					if (bar) bar.classList.add('complete');
				}, 800);
				
				// 更新 UI
				if (btn) btn.style.display = 'none';
				
				const warning = document.getElementById('dictWarning');
				if (warning) {
					warning.innerHTML = '<i class="ri-checkbox-circle-fill" style="margin-right:2px;"></i> 词库已就绪 (SQLite)';
					warning.style.color = '#10b981';
					warning.style.display = 'block';
				}

			} catch (e) {
				console.error('极速载入失败:', e);
				window.isDictLoading = false;
				setDictLoadStatus(`词库加载失败：${e.message || '请重试'}`, 'error');
				setTopProgress(100);
				setTimeout(() => {
					const bar = document.getElementById('topProgressBar');
					if (bar) bar.classList.add('error');
				}, 100);
				
				if (btn) {
					btn.innerHTML = '❌ 加载失败 (点击重试)';
					btn.disabled = false; // 失败允许重试
					btn.classList.add('error');
				}
			}
		};

		// 极速获取数据函数 (兼容性保留，实际查询已迁移到 SQLite)
		async function getFromDB(key) {
			// 查询 SQLite
			if (window.dbManager) {
				const results = await window.dbManager.queryExact(key);
				if (results && results.length > 0) {
					return results.map(row => row.phrase);
				}
			}
			return null;
		}

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

			if (!raw || /[a-z]/i.test(raw) === false) return null;

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
				if (!parts || !tone) return;
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
			{ name: '乜斜辙', finals: ['ie', 've'] },
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
				const phraseLen = phrase.length;
				if (!matchedByWordCount[phraseLen]) matchedByWordCount[phraseLen] = new Set();
				matchedByWordCount[phraseLen].add(phrase);
			};
	
			// 1. 精确匹配（通过 SQLite IN 查询）- 这部分非常快
			const BATCH_SIZE = 500; // 提升批次大小，减少 Worker 往返次数
			for (let i = 0; i < variantKeys.length; i += BATCH_SIZE) {
				const batch = variantKeys.slice(i, i + BATCH_SIZE);
				const results = await window.dbManager.queryByKeys(batch);
				for (const row of results) addMatch(row.phrase);
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
	
			// 2. 后缀匹配（批量，单次 Worker 调用）
			// 把所有变体 key 的后缀查询合并为一次 querySuffixBatch，消除 N+1 问题
			if (queryVariantSet.size > 0) {
				// 检查是否被中断
				if (searchId !== currentSearchId) return null;
	
				const batchQueries = [];
				for (const qk of queryVariantSet) {
					if (qk.length >= 2) {
						batchQueries.push({
							suffix2: qk.slice(-2),
							minLength: sourceLength,
							encodedKey: qk
						});
					}
				}
	
				if (batchQueries.length > 0) {
					const results = await window.dbManager.querySuffixBatch(batchQueries, 500);
					for (const row of results) addMatch(row.phrase);
					devLog(`[Tier ${tier}] 后缀批量查询完成，结果数: ${results.length}`);
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
							const pLen = Array.from(phrase).length;
							
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
			if (tier === 0) return [fin];

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
				if (src.fin === pInfo.fin && src.tone === pInfo.tone) {
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

				// 声母类型过滤 (非平翘舌音不匹配平翘舌音)
				// 对于更多匹配结果，放松这个限制以显示更多选项
				const srcIsSpecial = specialInitials.includes(src.ini);
				const matchIsSpecial = specialInitials.includes(pInfo.ini);
				if (!srcIsSpecial && matchIsSpecial) {
					// 只在严格模式下才严格过滤
					if (tierLimit === 0) return -1;
				}
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
			return proxy.replace(/\/$/, '');
		};

		const requestGemini = async (prompt, apiKey, proxy) => {
			const baseUrl = getGeminiBaseUrl(proxy);
			const response = await fetch(`${baseUrl}/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
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

		const processAI = async (src, infos, looseness) => {
			if (isAiLoading) return; // 防止并发请求
			const apiKey = localStorage.getItem('GEMINI_API_KEY');
			const proxy = localStorage.getItem('GEMINI_PROXY') || '';
			if (!apiKey) {
				alert('请先输入 Gemini API Key');
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
				const text = await requestGemini(prompt, apiKey, proxy);
				
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
			const apiKey = document.getElementById('geminiApiKey')?.value.trim();
			const proxy = document.getElementById('geminiProxy')?.value.trim() || '';
			if (!statusEl || !testBtn) return;

			if (!apiKey) {
				statusEl.textContent = '请先填写 Gemini API Key。';
				statusEl.dataset.type = 'error';
				return;
			}

			statusEl.textContent = '正在测试连接...';
			statusEl.dataset.type = 'info';
			testBtn.disabled = true;
			try {
				await requestGemini('请回复“连接成功”四个字。', apiKey, proxy);
				statusEl.textContent = '连接成功，API 可用。';
				statusEl.dataset.type = 'success';
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

		// 仅支持中文输入（本项目为中文韵脚查询）
		if (!hasChineseChars(src)) {
			setGenerateButtonsLoading(false);
			clearSlowQueryFeedback();
			render([], '<i class="ri-alert-fill" style="color:#f59e0b; margin-right:4px;"></i> 仅支持中文词语查询，请输入中文。', null, '');
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
				
				// 按等级排序 (0 < 1 < 2)
				matchesWithTier.sort((a, b) => a.tier - b.tier);
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
					const firstPhrase = Array.from(ranked[0]); // 第一条作为默认生成
					
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
					resultsWithTier.push({ phrase: text, tier: getPhraseMatchTier(text, infos, looseness) });
				}
				
				// 2. 处理字典中的其他相同字数结果
				if (dictResult && dictResult.sameLength && dictResult.sameLength.length > 0) {
					for (const phrase of dictResult.sameLength) {
						if (phrase !== text) {
							const tier = skipFilter ? 0 : getPhraseMatchTier(phrase, infos, looseness);
							if (tier !== -1) {
								if (!resultsWithTier.some(r => r.phrase === phrase)) {
									resultsWithTier.push({ phrase, tier });
								}
							}
						}
					}
				}
				
				// 3. 排序 (按等级 0 -> 1 -> 2)
				resultsWithTier.sort((a, b) => a.tier - b.tier);

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
					span.textContent = item.phrase;
					
					// 设置不同等级的颜色 (更亮、更高对比度的配色方案)
					if (item.tier === 0) {
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
					
					// 增加一致性过滤：确保更多匹配结果也符合韵脚规则
					// 对于更多匹配结果，使用更宽松的过滤以显示更多选项
					const matchTier = getPhraseMatchTier(phrase, infos, looseness);
					if (matchTier === -1) return;
					
					// 在较低宽松度下，可以接受中等匹配及以上的结果
					const tierLimit = getLoosenessTier(looseness);
					if (matchTier > Math.min(tierLimit + 1, 2)) return;

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
				btn.innerHTML = `<span class="history-index">${index + 1}.</span><span class="history-text">${item}</span>`;
				btn.addEventListener('click', () => {
					sourceInput.value = item;
					sourceInput.blur();
					process();
				});
				historyListEl.appendChild(btn);
			});
		};

		const init = () => {
			document.getElementById('go').addEventListener('click', process);
			const goStickyBtn = document.getElementById('goSticky');
			if (goStickyBtn) {
				goStickyBtn.addEventListener('click', () => {
					const source = document.getElementById('source');
					if (source) source.blur();
					process();
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

			const loadDictBtn = document.getElementById('loadDictBtn');
			loadDictBtn.addEventListener('click', () => {
				// 如果已经在加载中，不重复触发
				if (window.isDictLoading) return;
				loadDict();
			});

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
						
						// 清理新的 SQLite DB
						const deleteRequest = indexedDB.deleteDatabase('RhymeSQLiteDB');
						deleteRequest.onsuccess = () => {
							console.log('SQLite IndexedDB 清理成功');
						};
						deleteRequest.onerror = (err) => {
							console.warn('IndexedDB 清理失败:', err);
						};
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
					const loadDictBtn = document.getElementById('loadDictBtn');
					if (loadDictBtn) {
						loadDictBtn.disabled = false;
						loadDictBtn.innerHTML = '📚 加载词库';
						loadDictBtn.style.cursor = 'pointer';
						loadDictBtn.style.opacity = '1';
					}

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
				if (aiTestStatus) {
					aiTestStatus.textContent = '';
				}
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
				if (aiTestStatus) {
					aiTestStatus.textContent = '设置已保存。';
					aiTestStatus.dataset.type = 'success';
				}
				closeModal();
			});

			if (testAiSettingsBtn) {
				testAiSettingsBtn.addEventListener('click', testAiConnection);
			}

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
					setDictLoadStatus('检测到本地词库缓存，可直接使用。', 'success');
				} else {
					setDictLoadStatus('首次使用将自动加载词库，请稍候。');
				}
			};
			
			updateDictStatus();
			renderQuickLists();

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
