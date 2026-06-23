use once_cell::sync::OnceCell;
use wasm_bindgen::prelude::*;
use std::collections::HashSet;

static DICT_DATA: OnceCell<Vec<u8>> = OnceCell::new();
static ENTRY_COUNT: OnceCell<usize> = OnceCell::new();
static KEYS_START: OnceCell<usize> = OnceCell::new();
static WORDS_START: OnceCell<usize> = OnceCell::new();

#[wasm_bindgen]
pub fn init_dict(data: Vec<u8>) -> bool {
    if DICT_DATA.get().is_some() {
        return true;
    }

    if data.len() < 24 {
        return false;
    }

    let entry_count = u32::from_le_bytes([data[0], data[1], data[2], data[3]]) as usize;
    let keys_start = u32::from_le_bytes([data[4], data[5], data[6], data[7]]) as usize;
    let words_start = u32::from_le_bytes([data[8], data[9], data[10], data[11]]) as usize;

    if data.len() < words_start {
        return false;
    }

    if DICT_DATA.set(data).is_err() {
        return false;
    }
    let _ = ENTRY_COUNT.set(entry_count);
    let _ = KEYS_START.set(keys_start);
    let _ = WORDS_START.set(words_start);

    true
}

// 辅助：获取第 i 个 entry 的 key 原始字节切片
#[inline]
fn get_key_bytes(i: usize, data: &[u8], keys_start: usize) -> &[u8] {
    let index_offset = 24 + i * 12;
    let key_offset_in_keys = u32::from_le_bytes([
        data[index_offset],
        data[index_offset + 1],
        data[index_offset + 2],
        data[index_offset + 3]
    ]) as usize;
    
    let key_absolute_offset = keys_start + key_offset_in_keys;
    let key_len = data[key_absolute_offset] as usize;
    
    &data[key_absolute_offset + 1 .. key_absolute_offset + 1 + key_len]
}

// 辅助：获取第 i 个 entry 的 words 原始 UTF-8 字符串
#[inline]
fn get_words_str(i: usize, data: &[u8], words_start: usize) -> Option<&str> {
    let index_offset = 24 + i * 12;
    let words_offset_in_words = u32::from_le_bytes([
        data[index_offset + 4],
        data[index_offset + 5],
        data[index_offset + 6],
        data[index_offset + 7]
    ]) as usize;
    let words_len = u32::from_le_bytes([
        data[index_offset + 8],
        data[index_offset + 9],
        data[index_offset + 10],
        data[index_offset + 11]
    ]) as usize;

    let words_absolute_offset = words_start + words_offset_in_words;
    if words_absolute_offset + words_len <= data.len() {
        let slice = &data[words_absolute_offset .. words_absolute_offset + words_len];
        std::str::from_utf8(slice).ok()
    } else {
        None
    }
}

#[wasm_bindgen]
pub fn query_exact_batch(keys: Vec<String>) -> String {
    let data = match DICT_DATA.get() {
        Some(d) => d,
        None => return String::new(),
    };
    let entry_count = *ENTRY_COUNT.get().unwrap();
    let keys_start = *KEYS_START.get().unwrap();
    let words_start = *WORDS_START.get().unwrap();

    let mut seen_words = HashSet::new();
    let mut results = Vec::new();

    for key in keys {
        let reversed_key: String = key.chars().rev().collect();
        let target_bytes = reversed_key.as_bytes();

        let mut low_idx = 0;
        let mut high_idx = entry_count - 1;
        let mut found_idx = None;

        while low_idx <= high_idx {
            let mid = (low_idx + high_idx) >> 1;
            let mid_key_bytes = get_key_bytes(mid, data, keys_start);

            if mid_key_bytes == target_bytes {
                found_idx = Some(mid);
                break;
            } else if mid_key_bytes < target_bytes {
                low_idx = mid + 1;
            } else {
                if mid == 0 {
                    break;
                }
                high_idx = mid - 1;
            }
        }

        if let Some(idx) = found_idx {
            if let Some(words_str) = get_words_str(idx, data, words_start) {
                for w in words_str.split(',') {
                    let w_trimmed = w.trim();
                    if !w_trimmed.is_empty() && seen_words.insert(w_trimmed.to_string()) {
                        results.push(w_trimmed);
                    }
                }
            }
        }
    }

    results.join(",")
}

#[wasm_bindgen]
pub fn query_suffix_batch(keys: Vec<String>) -> String {
    let data = match DICT_DATA.get() {
        Some(d) => d,
        None => return String::new(),
    };
    let entry_count = *ENTRY_COUNT.get().unwrap();
    let keys_start = *KEYS_START.get().unwrap();
    let words_start = *WORDS_START.get().unwrap();

    let mut seen_words = HashSet::new();
    let mut results = Vec::new();

    for key in keys {
        let reversed_key: String = key.chars().rev().collect();
        let prefix_bytes = reversed_key.as_bytes();

        let mut low_idx = 0;
        let mut high_idx = entry_count - 1;

        while low_idx <= high_idx {
            let mid = (low_idx + high_idx) >> 1;
            let mid_key_bytes = get_key_bytes(mid, data, keys_start);

            if mid_key_bytes < prefix_bytes {
                low_idx = mid + 1;
            } else {
                if mid == 0 {
                    break;
                }
                high_idx = mid - 1;
            }
        }

        for i in low_idx..entry_count {
            let key_bytes = get_key_bytes(i, data, keys_start);
            if key_bytes.starts_with(prefix_bytes) {
                if let Some(words_str) = get_words_str(i, data, words_start) {
                    for w in words_str.split(',') {
                        let w_trimmed = w.trim();
                        if !w_trimmed.is_empty() && seen_words.insert(w_trimmed.to_string()) {
                            results.push(w_trimmed);
                        }
                    }
                }
            } else {
                break;
            }
        }
    }

    results.join(",")
}
