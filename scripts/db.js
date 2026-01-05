/**
 * 数据库模块 - 处理 IndexedDB 持久化存储
 * @module db
 */

const DB_NAME = 'FakerRhymesDB';
const DB_VERSION = 1;
const STORE_NAME = 'custom_phrases';

class RhymeDB {
    constructor() {
        this.db = null;
    }

    /**
     * 打开并初始化数据库
     */
    async open() {
        if (this.db) return this.db;

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    const store = db.createObjectStore(STORE_NAME, { keyPath: 'word' });
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                    store.createIndex('tags', 'tags', { unique: false, multiEntry: true });
                }
            };
        });
    }

    /**
     * 添加或更新词条
     * @param {Object|Object[]} data 
     */
    async put(data) {
        await this.open();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            
            const items = Array.isArray(data) ? data : [data];
            items.forEach(item => {
                if (typeof item === 'string') {
                    item = { word: item, timestamp: Date.now(), tags: [], weight: 1 };
                } else if (!item.timestamp) {
                    item.timestamp = Date.now();
                }
                store.put(item);
            });

            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    /**
     * 获取所有词条
     */
    async getAll() {
        await this.open();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 删除词条
     * @param {string} word 
     */
    async delete(word) {
        await this.open();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const request = store.delete(word);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 清空存储
     */
    async clear() {
        await this.open();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const request = store.clear();

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }
}

window.DB = new RhymeDB();
