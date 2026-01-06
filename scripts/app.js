/**
 * 主应用模块 - 处理 UI 交互和业务逻辑
 * @module app
 */

(function() {
const { RhymeEngine, DictManager } = window;
const { toInfo, getLoosenessTier, filterByPingZe, phraseFitsSource, devLog } = RhymeEngine;

let currentInfos = [];
let currentDictResult = null;
let pinyinReady = false;

/**
 * AI 生成押韵词
 */
const processAI = async (src, infos, looseness) => {
	const apiKey = localStorage.getItem('GEMINI_API_KEY');
	const proxyUrl = localStorage.getItem('GEMINI_PROXY');
	const modelName = localStorage.getItem('GEMINI_MODEL') || 'gemini-2.0-flash';

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
【等级】：Tier ${tier}

任务：
1. 生成至少 25 个与输入词语押韵的中文词语。
2. 生成的词语不能和输入词语相同。
3. 生成字数相同的词语25个,也生成15个包含字数更多尾部押韵的词语。
4. 必须严格遵守韵脚和音调要求（除非等级Tier较高）。
5. 只返回词语列表，用空格分隔，不要有任何解释。`;

	try {
		const result = await window.electronAPI.generateContent(apiKey, prompt, proxyUrl, modelName);

		if (!result.success) {
			throw new Error(result.error || 'API 调用失败');
		}

		const text = result.text.trim();
		const aiWords = (text.match(/[\u4e00-\u9fa5]+/g) || []).filter(w => w && w !== src);

		if (aiWords.length === 0) {
			throw new Error('AI 未返回有效的押韵词');
		}

		const sourceLength = Array.from(src).length;
		const dictResult = {
			sameLength: aiWords.filter(w => Array.from(w).length === sourceLength),
			lessLength: aiWords.filter(w => Array.from(w).length < sourceLength),
			moreLengths: aiWords.filter(w => Array.from(w).length > sourceLength)
		};

		const firstAiWord = dictResult.sameLength[0] || aiWords[0] || src;
		const aiChars = Array.from(firstAiWord);
		const newInfos = infos.map((info, idx) => ({
			...info,
			generated: aiChars[idx] || info.char,
			candidates: dictResult.sameLength.map(w => Array.from(w)[idx]).filter(Boolean),
			locked: false
		}));

		currentInfos = newInfos;
		currentDictResult = dictResult;
		render(newInfos, firstAiWord, dictResult, src, true);

		const seen = new Set();
		[...dictResult.lessLength, ...dictResult.moreLengths].forEach(phrase => {
			if (seen.has(phrase)) return;
			seen.add(phrase);
			const span = document.createElement('span');
			span.className = 'phrase-span';
			span.textContent = phrase;
			matchedResultsList.appendChild(span);
		});
		document.getElementById('matchedResults').style.display = 'block';

	} catch (e) {
		console.error('AI 生成失败:', e);
		output.textContent = '❌ AI 生成失败: ' + e.message;
	} finally {
		document.getElementById('go').classList.remove('loading');
	}
};

/**
 * 执行生成逻辑
 */
const process = () => {
	const startTime = performance.now(); // 开始计时
	const goBtn = document.getElementById('go');
	const src = document.getElementById('source').value.trim();
	const looseness = Number(document.getElementById('looseness').value);
	const isAiMode = document.getElementById('aiMode').checked;
	const pingzeFilter = document.querySelector('input[name="pingze"]:checked')?.value || 'all';
	
	goBtn.classList.add('loading');
	
	if (!pinyinReady) {
		goBtn.classList.remove('loading');
		render([], '拼音库加载中...', null, '');
		return;
	}

	if (!src) {
		goBtn.classList.remove('loading');
		render([], '等待输入...', null, '');
		return;
	}

	const oldInfos = currentInfos.slice();
	const tempInfos = Array.from(src).map((ch, idx) => {
		const info = toInfo(ch);
		const old = oldInfos[idx];
		const forcedTone = old && old.forcedTone !== null ? old.forcedTone : null;
		if (!info) return { char: ch, raw: '-', tone: '-', baseTone: '-', fin: '-', forcedTone };
		return { ...info, baseTone: info.tone, tone: forcedTone !== null ? forcedTone : info.tone, forcedTone };
	});

	if (isAiMode) {
		processAI(src, tempInfos, looseness);
		return;
	}
	
	const dictResult = DictManager.queryDict(tempInfos, looseness);
	currentDictResult = dictResult;
	
	const userInput = src;
	const matchedResultsList = document.getElementById('matchedResultsList');
	matchedResultsList.innerHTML = '';
	
	const seen = new Set();
	const appendPhrase = (phrase) => {
		if (seen.has(phrase) || phrase === userInput || phrase.includes(userInput)) return;
		seen.add(phrase);
		const span = document.createElement('span');
		span.style.cssText = 'padding: 6px 12px; background: var(--card); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: 14px;';
		span.textContent = phrase;
		matchedResultsList.appendChild(span);
	};

	if (dictResult) {
		const allCandidates = [];
		if (dictResult.lessLength) allCandidates.push(...dictResult.lessLength);
		if (dictResult.moreLengths) allCandidates.push(...dictResult.moreLengths);
		
		const groups = new Map();
		allCandidates.forEach(p => {
			if (p === userInput || p.includes(userInput)) return;
			const key = p.length >= 2 ? p.slice(-2) : p;
			if (!groups.has(key)) groups.set(key, []);
			groups.get(key).push(p);
		});
		
		for (const list of groups.values()) {
			const picked = list[Math.floor(Math.random() * list.length)];
			appendPhrase(picked);
		}
	}
	
	document.getElementById('matchedResults').style.display = 'block';

	let newInfos;
	if (dictResult && dictResult.sameLength && dictResult.sameLength.length > 0) {
		const ranked = dictResult.sameLength.filter(p => p !== userInput && !p.includes(userInput) && phraseFitsSource(p, tempInfos, looseness));
		
		if (ranked.length === 0) {
			newInfos = tempInfos.map((info, idx) => {
				if (info.fin === '-') return { ...info, generated: info.char, locked: false };
				if (oldInfos[idx]?.locked) return { ...info, ...oldInfos[idx] };
				const candidate = DictManager.pickFromMap(info.fin, info.tone, looseness);
				return { ...info, generated: candidate || info.char, locked: false };
			});
		} else {
			const firstPhrase = Array.from(ranked[0]);
			newInfos = tempInfos.map((info, idx) => {
				if (oldInfos[idx]?.locked) return { ...info, ...oldInfos[idx] };
				return { 
					...info, 
					generated: firstPhrase[idx], 
					candidates: ranked.map(p => Array.from(p)[idx]),
					locked: false 
				};
			});
		}
	} else {
		newInfos = tempInfos.map((info, idx) => {
			if (info.fin === '-') return { ...info, generated: info.char, locked: false };
			if (oldInfos[idx]?.locked) return { ...info, ...oldInfos[idx] };
			const candidate = DictManager.pickFromMap(info.fin, info.tone, looseness);
			return { ...info, generated: candidate || info.char, locked: false };
		});
	}
	
	currentInfos = newInfos;
	render(currentInfos, currentInfos.map(i => i.generated).join(''), currentDictResult, userInput);
	goBtn.classList.remove('loading');

	const endTime = performance.now();
	console.log(`查询耗时: ${(endTime - startTime).toFixed(2)}ms`);
};

/**
 * 渲染结果
 */
const render = (infos, text, dictResult, userInput, skipFilter = false) => {
	const output = document.getElementById('output');
	const badges = document.getElementById('badges');
	const looseness = Number(document.getElementById('looseness').value);
	const pingzeFilter = document.querySelector('input[name="pingze"]:checked')?.value || 'all';

	if (output) {
		let results = (text && text !== userInput) ? [text] : [];
		if (dictResult?.sameLength) {
			dictResult.sameLength.forEach(phrase => {
				if (phrase !== text && phrase !== userInput && !results.includes(phrase)) {
					if (skipFilter || phraseFitsSource(phrase, infos, looseness)) {
						results.push(phrase);
					}
				}
			});
		}
		
		if (pingzeFilter !== 'all') {
			results = filterByPingZe(results, pingzeFilter);
		}
		
		output.innerHTML = results.map(r => `<span class="phrase-span">${r}</span>`).join('') || '-';
	}

	if (badges && text) {
		badges.innerHTML = `<div class="badge"><i class="ri-sparkling-line"></i> ${text.length} 字</div>`;
	}

	const body = document.getElementById('detailBody');
	body.innerHTML = '';
	infos.forEach((i, index) => {
		const tr = document.createElement('tr');
		tr.innerHTML = `
			<td>${i.char}</td>
			<td>${i.raw || '-'}</td>
			<td>${i.tone || '-'}</td>
			<td>
				<input type="text" value="${i.fin || '-'}" class="fin-input" data-index="${index}">
				${i.tone !== '-' ? `
				<select class="tone-select" data-index="${index}">
					<option value="" ${i.forcedTone === null ? 'selected' : ''}>原</option>
					${[1,2,3,4].map(t => `<option value="${t}" ${i.forcedTone == t ? 'selected' : ''}>${t}</option>`).join('')}
				</select>` : ''}
			</td>
		`;
		body.appendChild(tr);
	});

	// Re-bind events for inputs/selects in the table
	body.querySelectorAll('.fin-input').forEach(input => {
		input.addEventListener('input', (e) => {
			const idx = parseInt(e.target.dataset.index);
			if (currentInfos[idx]) {
				currentInfos[idx].fin = e.target.value;
				process();
			}
		});
	});

	body.querySelectorAll('.tone-select').forEach(select => {
		select.addEventListener('change', (e) => {
			const idx = parseInt(e.target.dataset.index);
			if (currentInfos[idx]) {
				const val = e.target.value;
				currentInfos[idx].forcedTone = val === '' ? null : parseInt(val);
				currentInfos[idx].tone = currentInfos[idx].forcedTone !== null ? currentInfos[idx].forcedTone : currentInfos[idx].baseTone;
				process();
			}
		});
	});

	if (window.triggerResultAnimation) window.triggerResultAnimation();
};

/**
 * 初始化应用
 */
const init = () => {
	document.getElementById('go').addEventListener('click', process);
	document.getElementById('source').addEventListener('keydown', (e) => {
		if (e.key === 'Enter') {
			e.preventDefault(); // 阻止换行
			process();
		}
	});

	const loosenInput = document.getElementById('looseness');
	const loosenButtons = document.querySelectorAll('.looseness-btn');
	
	loosenButtons.forEach(btn => {
		btn.addEventListener('click', () => {
			const val = btn.getAttribute('data-value');
			loosenInput.value = val;
			
			// Update active class
			loosenButtons.forEach(b => b.classList.remove('active'));
			btn.classList.add('active');
			
			// Auto re-process if there is content
			if (document.getElementById('source').value.trim()) {
				process();
			}
		});
	});

	document.querySelectorAll('input[name="pingze"]').forEach(radio => {
		radio.addEventListener('change', () => {
			if (document.getElementById('source').value.trim()) {
				process();
			}
		});
	});

	document.getElementById('loadDictBtn').addEventListener('click', DictManager.loadOnlineDict);
	
	// AI 设置
	const aiModeCheckbox = document.getElementById('aiMode');
	if (localStorage.getItem('AI_MODE_ENABLED') === 'true') {
		aiModeCheckbox.checked = true;
	}
	aiModeCheckbox.addEventListener('change', (e) => {
		localStorage.setItem('AI_MODE_ENABLED', e.target.checked);
	});

	document.getElementById('openAiSettings').addEventListener('click', () => {
		document.getElementById('geminiApiKey').value = localStorage.getItem('GEMINI_API_KEY') || '';
		document.getElementById('geminiProxy').value = localStorage.getItem('GEMINI_PROXY') || '';
		document.getElementById('geminiModel').value = localStorage.getItem('GEMINI_MODEL') || 'gemini-2.0-flash';
		document.getElementById('aiSettingsModal').classList.add('active');
	});
	document.getElementById('saveAiSettings').addEventListener('click', () => {
		localStorage.setItem('GEMINI_API_KEY', document.getElementById('geminiApiKey').value.trim());
		localStorage.setItem('GEMINI_PROXY', document.getElementById('geminiProxy').value.trim());
		localStorage.setItem('GEMINI_MODEL', document.getElementById('geminiModel').value);
		document.getElementById('aiSettingsModal').classList.remove('active');
	});

	// 脚本加载
	const cdnList = ['https://cdn.jsdelivr.net/npm/pinyin-pro@3.27.0/dist/index.js'];
	const loadScripts = (list) => {
		if (!list.length) return;
		const s = document.createElement('script');
		s.src = list.shift();
		s.onload = () => {
			pinyinReady = true;
			DictManager.setBankMap(DictManager.registerBank());
		};
		document.head.appendChild(s);
	};
	loadScripts(cdnList);
	DictManager.loadDict();
	// 初始化词库状态
	if (DictManager) {
		(async () => {
			await DictManager.preloadCustomBank(); // 预加载自定义词库
			DictManager.updateDictStatus();
		})();
	}
};

window.addEventListener('DOMContentLoaded', () => {
	init();
});
})();
