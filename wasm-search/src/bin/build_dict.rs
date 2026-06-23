use std::collections::BTreeMap;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("--- FakerRhymes Rust 词典编译器 ---");

    let paths = ["../原始数据/dict_part1.txt", "../原始数据/dict_part2.txt"];
    let mut db = BTreeMap::new();

    for path in &paths {
        if !Path::new(path).exists() {
            println!("警告: 未找到文件 {}", path);
            continue;
        }
        println!("正在读取 {}...", path);
        let file = File::open(path)?;
        let reader = BufReader::new(file);

        for line_result in reader.lines() {
            let line = line_result?;
            let line = line.trim();
            if line.is_empty() {
                continue;
            }

            let parts: Vec<&str> = line.splitn(2, ':').collect();
            if parts.len() != 2 {
                continue;
            }

            let key = parts[0].trim();
            let words_str = parts[1].trim();

            // 反转 key 字符串，确保在二分中前缀匹配支持后缀押韵
            let reversed_key: String = key.chars().rev().collect();

            db.entry(reversed_key)
                .and_modify(|existing: &mut String| {
                    existing.push(',');
                    existing.push_str(words_str);
                })
                .or_insert_with(|| words_str.to_string());
        }
    }

    println!("读取完毕，共解析到 {} 个拼音键。正在去重与统计...", db.len());

    let entry_count = db.len();
    let mut total_words_count = 0;
    let mut lyric_words_count = 0;

    let mut keys_buf = Vec::new();
    let mut words_buf = Vec::new();
    let mut index_entries = Vec::new();

    for (reversed_key, words_str) in &db {
        // 对词汇列表去重
        let mut words: Vec<&str> = words_str.split(',').map(|w| w.trim()).filter(|w| !w.is_empty()).collect();
        words.sort_unstable();
        words.dedup();

        total_words_count += words.len() as u32;
        for w in &words {
            if w.ends_with('*') {
                lyric_words_count += 1;
            }
        }

        let clean_words_str = words.join(",");

        // 1. 打包 Key: [len: u8][ASCII chars]
        let key_bytes = reversed_key.as_bytes();
        let key_len = key_bytes.len();
        if key_len > 255 {
            return Err("Key 长度超限".into());
        }
        
        let cur_key_offset = keys_buf.len() as u32;
        keys_buf.push(key_len as u8);
        keys_buf.extend_from_slice(key_bytes);

        // 2. 打包 Words (UTF-8)
        let words_bytes = clean_words_str.as_bytes();
        let cur_words_offset = words_buf.len() as u32;
        let words_len = words_bytes.len() as u32;

        words_buf.extend_from_slice(words_bytes);

        index_entries.push((cur_key_offset, cur_words_offset, words_len));
    }

    // Header 24 字节
    // Index Block 大小 = entry_count * 12 字节
    let index_size = entry_count * 12;
    let keys_start = 24 + index_size;
    let words_start = keys_start + keys_buf.len();

    let mut header = Vec::with_capacity(24);
    header.extend_from_slice(&(entry_count as u32).to_le_bytes());
    header.extend_from_slice(&(keys_start as u32).to_le_bytes());
    header.extend_from_slice(&(words_start as u32).to_le_bytes());
    header.extend_from_slice(&total_words_count.to_le_bytes());
    header.extend_from_slice(&lyric_words_count.to_le_bytes());
    header.extend_from_slice(&[0u8; 4]); // 4 字节保留

    let mut index_buf = Vec::with_capacity(index_size);
    for &(key_off, words_off, words_len) in &index_entries {
        index_buf.extend_from_slice(&key_off.to_le_bytes());
        index_buf.extend_from_slice(&words_off.to_le_bytes());
        index_buf.extend_from_slice(&words_len.to_le_bytes());
    }

    // 拼装完整文件
    let mut dict_bin = Vec::new();
    dict_bin.extend_from_slice(&header);
    dict_bin.extend_from_slice(&index_buf);
    dict_bin.extend_from_slice(&keys_buf);
    dict_bin.extend_from_slice(&words_buf);

    let total_length = dict_bin.len();
    
    // 均匀切分为两半
    let half_length = (total_length + 1) / 2;
    let (bin_part1, bin_part2) = dict_bin.split_at(half_length);

    let out_path1 = "../dict_part1.bin";
    let out_path2 = "../dict_part2.bin";

    std::fs::write(out_path1, bin_part1)?;
    std::fs::write(out_path2, bin_part2)?;

    println!("--- 词典构建圆满成功 (Rust) ---");
    println!("生成分片 1: {} ({:.2} MB)", out_path1, (bin_part1.len() as f64) / 1024.0 / 1024.0);
    println!("生成分片 2: {} ({:.2} MB)", out_path2, (bin_part2.len() as f64) / 1024.0 / 1024.0);
    println!("总合并大小: {:.2} MB", (total_length as f64) / 1024.0 / 1024.0);
    println!("总词语数: {}", total_words_count);
    println!("歌词词语数: {}", lyric_words_count);

    Ok(())
}
