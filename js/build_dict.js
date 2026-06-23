const fs = require('fs');
const path = require('path');

function main() {
    console.log('--- FakerRhymes 二进制字典编译器 ---');

    const part1Path = path.join(__dirname, '../原始数据/dict_part1.txt');
    const part2Path = path.join(__dirname, '../原始数据/dict_part2.txt');

    if (!fs.existsSync(part1Path) || !fs.existsSync(part2Path)) {
        console.error('错误: dict_part1.txt 或 dict_part2.txt 不存在，请确保字典文件放置在项目根目录的“原始数据”文件夹中！');
        process.exit(1);
    }

    console.log('读取文本词典中...');
    const part1 = fs.readFileSync(part1Path, 'utf8');
    const part2 = fs.readFileSync(part2Path, 'utf8');

    console.log('解析并转换数据中...');
    const db = new Map(); // reversed_key -> words_str

    const lines = (part1 + '\n' + part2).split(/\r?\n/);
    let parsedCount = 0;
    
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const colonIdx = trimmed.indexOf(':');
        if (colonIdx === -1) continue;

        const key = trimmed.slice(0, colonIdx).trim();
        const words = trimmed.slice(colonIdx + 1).trim();

        // 反转拼音 key（例如：a1_b2 -> 2b1a）以利用前缀搜索实现高效的后缀押韵匹配
        const reversed = key.split('').reverse().join('');

        if (db.has(reversed)) {
            db.set(reversed, db.get(reversed) + ',' + words);
        } else {
            db.set(reversed, words);
        }
        parsedCount++;
    }

    console.log(`解析完毕。共处理了 ${parsedCount} 行文本。`);
    
    // 对所有的 Key 进行严格升序排序
    const sortedKeys = Array.from(db.keys()).sort();
    const entryCount = sortedKeys.length;
    console.log(`合并去重后，共得到 ${entryCount} 个排好序的拼音键。`);

    console.log('打包二进制数据包中...');
    
    const keysBufferList = [];
    let keysOffset = 0;
    const wordsBufferList = [];
    let wordsOffset = 0;
    
    const indexEntries = []; // 保存每个 entry 的元数据
    let totalWordsCount = 0;
    let lyricWordsCount = 0;

    for (const reversedKey of sortedKeys) {
        let wordsStr = db.get(reversedKey);
        
        // 对词汇列表去重，保证词典紧凑
        let wordList = wordsStr.split(',').map(w => w.trim()).filter(Boolean);
        wordList = Array.from(new Set(wordList));
        
        totalWordsCount += wordList.length;
        for (const w of wordList) {
            if (w.endsWith('*')) {
                lyricWordsCount++;
            }
        }

        const cleanWordsStr = wordList.join(',');

        // 1. 打包 Key：格式为 [key_len: u8][ASCII chars]
        const keyBytes = Buffer.from(reversedKey, 'ascii');
        const keyLen = keyBytes.length;
        const keyRecord = Buffer.alloc(1 + keyLen);
        keyRecord[0] = keyLen;
        keyBytes.copy(keyRecord, 1);

        const curKeyOffset = keysOffset;
        keysBufferList.push(keyRecord);
        keysOffset += keyRecord.length;

        // 2. 打包 Words (UTF-8 编码)
        const wordsBytes = Buffer.from(cleanWordsStr, 'utf8');
        const curWordsOffset = wordsOffset;
        const wordsLen = wordsBytes.length;

        wordsBufferList.push(wordsBytes);
        wordsOffset += wordsLen;

        indexEntries.push({
            keyOffset: curKeyOffset,
            wordsOffset: curWordsOffset,
            wordsLen: wordsLen
        });
    }

    // Header 占用 24 字节
    // Index Block 占用 entryCount * 12 字节
    const indexSize = entryCount * 12;
    const keysStart = 24 + indexSize;
    const wordsStart = keysStart + keysOffset;

    // 写入 Header
    const header = Buffer.alloc(24);
    header.writeUInt32LE(entryCount, 0);
    header.writeUInt32LE(keysStart, 4);
    header.writeUInt32LE(wordsStart, 8);
    header.writeUInt32LE(totalWordsCount, 12);
    header.writeUInt32LE(lyricWordsCount, 16);
    // 20..24 字节填 0 保留

    // 写入 Index Block
    const indexBuf = Buffer.alloc(indexSize);
    for (let i = 0; i < entryCount; i++) {
        const entry = indexEntries[i];
        const offset = i * 12;
        indexBuf.writeUInt32LE(entry.keyOffset, offset + 0);
        indexBuf.writeUInt32LE(entry.wordsOffset, offset + 4);
        indexBuf.writeUInt32LE(entry.wordsLen, offset + 8);
    }

    const keysBuf = Buffer.concat(keysBufferList);
    const wordsBuf = Buffer.concat(wordsBufferList);

    // 拼装完整的二进制文件
    const dictBin = Buffer.concat([header, indexBuf, keysBuf, wordsBuf]);
    const totalLength = dictBin.length;
    
    // 均匀切分为两半
    const halfLength = Math.ceil(totalLength / 2);
    const binPart1 = dictBin.subarray(0, halfLength);
    const binPart2 = dictBin.subarray(halfLength);

    const outPath1 = path.join(__dirname, '../dict_part1.bin');
    const outPath2 = path.join(__dirname, '../dict_part2.bin');
    
    fs.writeFileSync(outPath1, binPart1);
    fs.writeFileSync(outPath2, binPart2);

    console.log('--- 词典构建圆满成功 ---');
    console.log(`生成分片 1: ${outPath1} (${(binPart1.length / 1024 / 1024).toFixed(2)} MB)`);
    console.log(`生成分片 2: ${outPath2} (${(binPart2.length / 1024 / 1024).toFixed(2)} MB)`);
    console.log(`总合并大小: ${(totalLength / 1024 / 1024).toFixed(2)} MB`);
    console.log(`索引大小: ${(indexSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Keys 大小: ${(keysOffset / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Words 大小: ${(wordsOffset / 1024 / 1024).toFixed(2)} MB`);
    console.log(`总词语数: ${totalWordsCount}`);
    console.log(`歌词词语数: ${lyricWordsCount}`);
}

main();
