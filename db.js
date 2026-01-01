/**
 * IndexedDB management for dictionary storage
 * Optimized for mobile: uses multiple keys instead of one giant object
 */
const DB_NAME = 'FakerRhymesDB';
const DB_VERSION = 2; // Increment version
const STORE_NAME = 'dictionary';
const META_STORE = 'metadata';

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
            if (!db.objectStoreNames.contains(META_STORE)) {
                db.createObjectStore(META_STORE);
            }
            // If upgrading from v1, clear old giant data
            if (event.oldVersion < 2 && db.objectStoreNames.contains(STORE_NAME)) {
                // store.clear() will be called in transaction
            }
        };

        request.onsuccess = (event) => resolve(event.target.result);
        request.onerror = (event) => reject(event.target.error);
    });
}

/**
 * Saves dictionary in chunks to avoid memory spikes
 */
async function saveDictToIndexedDB(dictData, chars, stats, sourceName) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME, META_STORE], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const meta = transaction.objectStore(META_STORE);
        
        store.clear();

        // 1. Save dictionary entries individually
        if (dictData && typeof dictData === 'object') {
            for (const [key, value] of Object.entries(dictData)) {
                store.put(value, key);
            }
        }

        // 2. Save metadata
        meta.put({
            chars,
            stats,
            sourceName,
            timestamp: Date.now(),
            keys: Object.keys(dictData)
        }, 'info');

        transaction.oncomplete = () => resolve();
        transaction.onerror = (event) => reject(event.target.error);
    });
}

/**
 * Loads the entire dictionary into memory
 */
async function loadDictFromIndexedDB() {
    const db = await openDB();
    const meta = await new Promise((resolve) => {
        const transaction = db.transaction([META_STORE], 'readonly');
        const request = transaction.objectStore(META_STORE).get('info');
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = () => resolve(null);
    });

    if (!meta) return null;

    const dict = {};
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.openCursor();

        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                dict[cursor.key] = cursor.value;
                cursor.continue();
            } else {
                resolve({
                    full: dict,
                    chars: meta.chars,
                    stats: meta.stats,
                    sourceName: meta.sourceName
                });
            }
        };
        request.onerror = (event) => reject(event.target.error);
    });
}

/**
 * Quick check if metadata exists
 */
async function getDictMetadata() {
    try {
        const db = await openDB();
        return new Promise((resolve) => {
            const transaction = db.transaction([META_STORE], 'readonly');
            const request = transaction.objectStore(META_STORE).get('info');
            request.onsuccess = (e) => resolve(e.target.result);
            request.onerror = () => resolve(null);
        });
    } catch (e) {
        return null;
    }
}
