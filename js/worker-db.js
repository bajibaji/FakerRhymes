// SQLite Database Worker

// 导入 sql.js
importScripts('lib/sql-wasm.min.js');

const DB_CONFIG = {
	locateFile: file => `lib/${file}`
};

let db = null;
let SQL = null;

// 初始化数据库
async function initDB() {
	if (db) return true;

	try {
		// 加载 sql.js
		SQL = await initSqlJs(DB_CONFIG);
		
		// 尝试从 IndexedDB 加载现有数据库
		const savedData = await loadFromIndexedDB();
		
		if (savedData) {
			db = new SQL.Database(new Uint8Array(savedData));
			ensureIndexes(); // 对已有数据库补建缺失索引
			console.log('[Worker] Database loaded from IndexedDB');
		} else {
			db = new SQL.Database();
			createTables();
			console.log('[Worker] New database created');
		}
		
		return true;
	} catch (err) {
		console.error('[Worker] Failed to initialize database:', err);
		throw err;
	}
}

// 创建表结构
function createTables() {
	db.run(`
		CREATE TABLE IF NOT EXISTS words (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			phrase TEXT NOT NULL,
			length INTEGER NOT NULL,
			encoded_key TEXT NOT NULL,
			suffix_2 TEXT NOT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		);
		
		CREATE INDEX IF NOT EXISTS idx_words_encoded_key ON words(encoded_key);
		CREATE INDEX IF NOT EXISTS idx_words_suffix_2 ON words(suffix_2);
		CREATE INDEX IF NOT EXISTS idx_words_length ON words(length);
		CREATE INDEX IF NOT EXISTS idx_words_suffix_length ON words(suffix_2, length);
		
		CREATE TABLE IF NOT EXISTS meta (
			key TEXT PRIMARY KEY,
			value TEXT
		);
	`);
}

// 检查并升级索引（对已有数据库补建缺失的复合索引）
function ensureIndexes() {
	try {
		db.run(`CREATE INDEX IF NOT EXISTS idx_words_suffix_length ON words(suffix_2, length)`);
	} catch(e) {
		console.warn('[Worker] ensureIndexes failed:', e);
	}
}

// 分块插入数据
function insertChunk(data) {
	if (!db || !data || data.length === 0) return;
	
	try {
		db.run("BEGIN TRANSACTION");
		const stmt = db.prepare("INSERT INTO words (phrase, length, encoded_key, suffix_2) VALUES (?, ?, ?, ?)");
		for (const item of data) {
			stmt.run([item.phrase, item.length, item.encoded_key, item.suffix_2]);
		}
		stmt.free();
		db.run("COMMIT");
		return true;
	} catch (err) {
		console.error('[Worker] Chunk insert failed:', err);
		db.run("ROLLBACK");
		throw err;
	}
}

// 查询精确匹配
function queryExact(encodedKey) {
	if (!db) return [];
	const stmt = db.prepare("SELECT phrase, encoded_key FROM words WHERE encoded_key = ? ORDER BY length ASC");
	stmt.bind([encodedKey]);
	const results = [];
	while (stmt.step()) results.push(stmt.getAsObject());
	stmt.free();
	return results;
}

// 查询后缀匹配（单个，保留兼容）
function querySuffix(suffix2, minLength, pattern) {
	if (!db) return [];
	let sql = `SELECT phrase, encoded_key FROM words WHERE suffix_2 = ? AND length > ? `;
	const params = [suffix2, minLength];
	if (pattern) {
		sql += ` AND encoded_key LIKE ? `;
		params.push(pattern);
	}
	sql += ` ORDER BY length ASC LIMIT 200 `;
	const stmt = db.prepare(sql);
	stmt.bind(params);
	const results = [];
	while (stmt.step()) results.push(stmt.getAsObject());
	stmt.free();
	return results;
}

// 批量后缀匹配：把 N 次 querySuffix 合并为 1 次 SQL 查询
// payload: { queries: [{suffix2, minLength, encodedKey}], globalLimit }
// 保留 LIKE '%xxx' 语义（后缀匹配），用 OR 批量合并，减少 Worker 往返次数
function querySuffixBatch(queries, globalLimit = 500) {
	if (!db || !queries || queries.length === 0) return [];

	const groups = new Map();
	for (const q of queries) {
		const groupKey = `${q.suffix2}||${q.minLength}`;
		if (!groups.has(groupKey)) {
			groups.set(groupKey, { suffix2: q.suffix2, minLength: q.minLength, keys: new Set() });
		}
		groups.get(groupKey).keys.add(q.encodedKey);
	}

	const results = [];
	const maxPerGroup = Math.ceil(globalLimit / Math.max(1, groups.size));
	for (const group of groups.values()) {
		if (results.length >= globalLimit) break;

		const { suffix2, minLength, keys } = group;
		const keyArr = Array.from(keys);
		const likeConditions = keyArr.map(() => `encoded_key LIKE ?`).join(' OR ');
		const sql = `SELECT phrase, encoded_key FROM words WHERE suffix_2 = ? AND length > ? AND (${likeConditions}) ORDER BY length ASC LIMIT ?`;
		const params = [suffix2, minLength, ...keyArr.map(k => '%' + k), maxPerGroup];
		const stmt = db.prepare(sql);
		stmt.bind(params);
		while (stmt.step()) results.push(stmt.getAsObject());
		stmt.free();
	}
	return results.slice(0, globalLimit);
}

// 查询多个键
function queryByKeys(keys) {
	if (!db || !keys.length) return [];
	const placeholders = keys.map(() => '?').join(',');
	const stmt = db.prepare(`SELECT phrase, encoded_key FROM words WHERE encoded_key IN (${placeholders}) ORDER BY length ASC`);
	stmt.bind(keys);
	const results = [];
	while (stmt.step()) results.push(stmt.getAsObject());
	stmt.free();
	return results;
}

// 检查数据是否存在
function checkDataExists() {
	if (!db) return false;
	try {
		const res = db.exec("SELECT count(*) as count FROM words");
		return res[0].values[0][0] > 0;
	} catch (e) {
		return false;
	}
}

// 重置数据库
function reset() {
	if (db) {
		try { db.close(); } catch(e) {}
		db = null;
	}
	return true;
}

// IndexedDB 操作
function loadFromIndexedDB() {
	return new Promise((resolve) => {
		const request = indexedDB.open('RhymeSQLiteDB', 1);
		request.onupgradeneeded = (e) => {
			const idb = e.target.result;
			if (!idb.objectStoreNames.contains('sqlite_store')) {
				idb.createObjectStore('sqlite_store');
			}
		};
		request.onsuccess = (e) => {
			const idb = e.target.result;
			const tx = idb.transaction(['sqlite_store'], 'readonly');
			const store = tx.objectStore('sqlite_store');
			const getReq = store.get('db_file');
			getReq.onsuccess = () => resolve(getReq.result);
			getReq.onerror = () => resolve(null);
		};
		request.onerror = () => resolve(null);
	});
}

function saveToIndexedDB() {
	if (!db) return Promise.resolve();
	try {
		const data = db.export();
		return new Promise((resolve) => {
			const request = indexedDB.open('RhymeSQLiteDB', 1);
			request.onsuccess = (e) => {
				const idb = e.target.result;
				const tx = idb.transaction(['sqlite_store'], 'readwrite');
				const store = tx.objectStore('sqlite_store');
				const putReq = store.put(data, 'db_file');
				putReq.onsuccess = () => resolve(true);
				putReq.onerror = () => resolve(false);
			};
			request.onerror = () => resolve(false);
		});
	} catch (err) {
		console.error('[Worker] Export failed:', err);
		return Promise.resolve(false);
	}
}

// 消息处理
self.onmessage = async function(e) {
	const { id, action, payload } = e.data;
	try {
		let result;
		switch (action) {
			case 'init': result = await initDB(); break;
			case 'insertChunk': result = insertChunk(payload); break;
			case 'queryExact': result = queryExact(payload); break;
			case 'querySuffix': result = querySuffix(payload.suffix2, payload.minLength, payload.pattern); break;
			case 'querySuffixBatch': result = querySuffixBatch(payload.queries, payload.globalLimit); break;
			case 'queryByKeys': result = queryByKeys(payload); break;
			case 'checkDataExists': result = checkDataExists(); break;
			case 'save': result = await saveToIndexedDB(); break;
			case 'reset': result = reset(); break;
			default: throw new Error('Unknown action: ' + action);
		}
		self.postMessage({ id, status: 'success', result });
	} catch (err) {
		self.postMessage({ id, status: 'error', error: err.toString() });
	}
};
