/**
 * 韵脚引擎模块 - 处理拼音解析和押韵匹配
 * @module rhyme-engine
 */

(function() {
// 开发模式开关
const DEV_MODE = false;
const devLog = (...args) => { if (DEV_MODE) console.log(...args); };

// 韵母列表（按长度排序，确保长韵母优先匹配）
const finals = [
	'iong', 'uang', 'iang', 'ueng', 'uan', 'ian', 'uen', 'iao', 'uai', 'ang', 'eng', 'ing', 'ong', 
	'ai', 'ei', 'ao', 'ou', 'an', 'en', 'in', 'un', 'vn', 'ia', 'ua', 'uo', 'ie', 'ue', 'ui', 'er', 
	'a', 'o', 'e', 'i', 'u', 'v'
];

// 十三辙分组
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
		'z-retroflex', 'c-retroflex', 's-retroflex',
		'zh-retroflex-e', 'ch-retroflex-e', 'sh-retroflex-e', 'r-retroflex-e'
	]
};

/**
 * 标准化拼音字符串
 * @param {string} p - 原始拼音
 * @returns {string} 标准化后的拼音
 */
const normalize = (p) => p.replace(/\d/g, '').replace(/ü/g, 'v').replace(/u:/g, 'v');

/**
 * 生成键值变体（兼容 v/u 形式）
 * @param {string} key - 原始键值
 * @returns {string[]} 键值变体数组
 */
const buildKeyVariants = (key) => {
	const base = String(key).replace(/ü/g, 'v').replace(/u:/g, 'v');
	const variants = new Set([base, base.replace(/v/g, 'u')]);
	return Array.from(variants);
};

/**
 * 提取声调
 * @param {string} p - 带声调的拼音
 * @returns {number} 声调数字 (1-4) 或 0
 */
const extractTone = (p) => {
	const m = p.match(/(\d)/);
	return m ? Number(m[1]) : 0;
};

/**
 * 检测韵母
 * @param {string} p - 标准化后的拼音
 * @returns {{initial: string, final: string}} 声母和韵母
 */
const detectFinal = (p) => {
	let normalizedP = p.replace(/ü/g, 'v').replace(/u:/g, 'v');
	
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
	
	// 特殊处理：j/q/x/y 后的 e 实际是 ie
	if (['j', 'q', 'x', 'y'].includes(initial) && rest === 'e') {
		rest = 'ie';
	}

	// i韵隔离协议 (Triple-I Isolation)
	if (rest === 'i') {
		if (['z', 'c', 's'].includes(initial)) {
			return { initial, final: 'i-flat' }; // 平舌音
		} else if (['zh', 'ch', 'sh', 'r'].includes(initial)) {
			return { initial, final: 'i-retro' }; // 翘舌音
		}
	}
	
	if (!rest) return { initial, final: normalizedP };
	
	return { initial, final: rest };
};

// 拼音信息缓存
const pinyinInfoCache = new Map();

/**
 * 将单个汉字转换为拼音信息
 * @param {string} char - 单个汉字
 * @returns {Object|null} 拼音信息对象
 */
const toInfo = (char) => {
	if (!char) return null;
	if (pinyinInfoCache.has(char)) {
		return pinyinInfoCache.get(char);
	}

	if (!window.pinyinPro || !window.pinyinPro.pinyin) return null;
	
	const raw = window.pinyinPro.pinyin(char, {
		type: 'array',
		toneType: 'num',
		pattern: 'pinyin'
	})[0];

	if (!raw || /[a-z]/i.test(raw) === false) return null;

	const clean = normalize(raw);
	const tone = extractTone(raw);
	const parts = detectFinal(clean);
	const result = parts ? { char, raw, clean, tone, fin: parts.final, ini: parts.initial } : null;
	
	if (result) {
		pinyinInfoCache.set(char, result);
	}
	return result;
};

/**
 * 获取宽松度等级
 * @param {number} value - 宽松度值 (0-1)
 * @returns {number} 等级 (0, 1, 2)
 */
const getLoosenessTier = (value) => {
	if (value >= 0.67) return 2;
	if (value >= 0.34) return 1;
	return 0;
};

// 韵母变体缓存
const finalVariantsCache = new Map();

/**
 * 构建韵母变体
 * @param {string} fin - 原始韵母
 * @param {number} tier - 宽松度等级
 * @returns {string[]} 韵母变体数组
 */
const buildFinalVariants = (fin, tier) => {
	const cacheKey = `${fin}_${tier}`;
	if (finalVariantsCache.has(cacheKey)) {
		return finalVariantsCache.get(cacheKey);
	}

	let result;
	if (tier === 0) {
		result = [fin];
	} else {
		// 前后鼻音合并
		const groupAnAng = ['an', 'ian', 'uan', 'van', 'üan', 'ang', 'iang', 'uang'];
		const groupEnEng = ['en', 'un', 'eng', 'ong', 'iong'];
		const groupInIng = ['in', 'vn', 'ün', 'ing'];

		if (groupAnAng.includes(fin)) {
			result = groupAnAng;
		} else if (groupEnEng.includes(fin)) {
			result = groupEnEng;
		} else if (groupInIng.includes(fin)) {
			result = groupInIng;
		} else {
			// 使用十三辙
			const track = thirteenTracks.find(t => t.finals.includes(fin));
			result = track ? track.finals : [fin];
		}
	}

	finalVariantsCache.set(cacheKey, result);
	return result;
};

/**
 * 平仄过滤函数
 * @param {string[]} phrases - 词语列表
 * @param {string} pingze - 过滤类型 ('all' | 'ping' | 'ze')
 * @returns {string[]} 过滤后的词语列表
 */
const filterByPingZe = (phrases, pingze) => {
	if (!pingze || pingze === 'all' || !Array.isArray(phrases)) {
		return phrases;
	}
	
	return phrases.filter(phrase => {
		if (!phrase || phrase.length === 0) return false;
		
		const chars = Array.from(phrase);
		const lastChar = chars[chars.length - 1];
		const lastInfo = toInfo(lastChar);
		
		if (!lastInfo || !lastInfo.tone || lastInfo.tone === '-') {
			return false;
		}
		
		const tone = Number(lastInfo.tone);
		
		if (pingze === 'ping') {
			return tone === 1 || tone === 2;
		} else if (pingze === 'ze') {
			return tone === 3 || tone === 4;
		}
		
		return true;
	});
};

/**
 * 检查候选短语是否匹配源词的韵脚
 * @param {string} phrase - 候选短语
 * @param {Object[]} sourceInfos - 源词拼音信息数组
 * @param {number} looseness - 宽松度
 * @returns {boolean} 是否匹配
 */
const phraseFitsSource = (phrase, sourceInfos, looseness) => {
	const tier = getLoosenessTier(looseness);
	const allowToneRelax = tier >= 2;
	const chars = Array.from(phrase);
	
	const len = Math.min(chars.length, sourceInfos.length);
	const srcOffset = sourceInfos.length - len;
	const phraseOffset = chars.length - len;

	const specialInitials = ['zh', 'ch', 'sh', 'r', 'z', 'c', 's'];

	for (let i = 0; i < len; i++) {
		const src = sourceInfos[srcOffset + i];
		const ch = chars[phraseOffset + i];
		const pInfo = ch ? toInfo(ch) : null;
		if (!src || !pInfo || !src.fin || src.fin === '-') return false;
		
		let rhymeOk = false;
		if (tier === 0) {
			rhymeOk = (src.fin === pInfo.fin);
		} else {
			const variants = buildFinalVariants(src.fin, tier);
			rhymeOk = variants.includes(pInfo.fin);
		}
		
		if (!rhymeOk) return false;
		
		const toneOk = allowToneRelax || (src.tone === pInfo.tone);
		if (!toneOk) return false;

		const srcIsSpecial = specialInitials.includes(src.ini);
		const matchIsSpecial = specialInitials.includes(pInfo.ini);
		
		if (!srcIsSpecial && matchIsSpecial) {
			return false;
		}
	}
	return true;
};

// 导出模块
window.RhymeEngine = {
	finals,
	thirteenTracks,
	legacyKeyMap,
	normalize,
	buildKeyVariants,
	extractTone,
	detectFinal,
	toInfo,
	getLoosenessTier,
	buildFinalVariants,
	filterByPingZe,
	phraseFitsSource,
	devLog,
	DEV_MODE
};
})();
