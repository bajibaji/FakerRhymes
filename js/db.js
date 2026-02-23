// SQLite Database Proxy (Main Thread)

const worker = new Worker('js/worker-db.js');
const pendingPromises = new Map();
let messageId = 0;

worker.onmessage = (e) => {
	const { id, status, result, error } = e.data;
	if (pendingPromises.has(id)) {
		const { resolve, reject } = pendingPromises.get(id);
		if (status === 'success') {
			resolve(result);
		} else {
			reject(new Error(error));
		}
		pendingPromises.delete(id);
	}
};

function sendToWorker(action, payload) {
	return new Promise((resolve, reject) => {
		const id = messageId++;
		pendingPromises.set(id, { resolve, reject });
		worker.postMessage({ id, action, payload });
	});
}

// 导出的接口 (保持与原 dbManager 一致)
window.dbManager = {
	init: () => sendToWorker('init'),
	
	insertBatch: async (data) => {
		await sendToWorker('insertChunk', data);
		return sendToWorker('save');
	},
	
	insertChunk: (data) => sendToWorker('insertChunk', data),
	
	save: () => sendToWorker('save'),
	
	queryExact: (encodedKey) => sendToWorker('queryExact', encodedKey),
	
	querySuffix: (suffix2, minLength, pattern) =>
		sendToWorker('querySuffix', { suffix2, minLength, pattern }),
	
	querySuffixBatch: (queries, globalLimit) =>
		sendToWorker('querySuffixBatch', { queries, globalLimit }),
	
	queryByKeys: (keys) => sendToWorker('queryByKeys', keys),
	
	checkDataExists: () => sendToWorker('checkDataExists'),
	
	reset: () => sendToWorker('reset')
};
