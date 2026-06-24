# FakerRhymes 词典结构与查询匹配逻辑技术指南

本文档整理了 FakerRhymes 项目中的核心词典数据结构、韵脚查询匹配逻辑以及如何导入新词典的完整指南，方便后续进行词库维护与扩展。

---

## 1. 词典数据结构分析 (`dict.txt`)

FakerRhymes 放弃了庞大臃肿的 JSON 字典文件，改用一个高度压缩的纯文本文件 [dict.txt](file:///d:/Documents/GitHub/FakerRhymes/dict.txt) 进行内存直连检索。

### 1.1 文件格式
`dict.txt` 每一行代表一个独立的**韵律编码**及其对应的**中文词组**，格式如下：
```text
[韵律编码Key]:[词语1],[词语2],[词语3],...
```
*   **Key**: 每个字的韵母映射代码 + 声调（1-4，轻声为 0）按字顺序无分隔拼接而成的字符串。
*   **Values**: 逗号 `,` 分隔的中文词语。
*   **换行符**: 统一使用标准的 `\n`。

**示例：**
```text
w1b1x4:低精度,西京赋,七星路,一丁目,吸睛度,西青路,七经路
```
*解释：* “低精度”的拼音是 `dī jīng dù`。
1. `低 (dī)` -> 韵母为 `i` (代码为 `w`)，声调为 `1` -> `w1`
2. `精 (jīng)` -> 韵母为 `ing` (代码为 `b`)，声调为 `1` -> `b1`
3. `度 (dù)` -> 韵母为 `u` (代码为 `x`)，声调为 `4` -> `x4`
拼接得到的 Key 即为 `w1b1x4`。

---

## 2. 韵母到缩写代号的映射表 (`finalToCode`)

系统使用 `finalToCode` Map 将拼音的韵母压缩为单字符代号。在生成或导入新词典时，**必须严格遵守**该映射关系。

| 韵母 | 编码 | 说明 | 韵母 | 编码 | 说明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **iong** | `0` | | **ang** | `9` | |
| **uang** | `1` | | **eng** | `a` | |
| **iang** | `2` | | **ing** | `b` | |
| **ueng** | `3` | | **ong** | `c` | |
| **uan** | `4` | | **ai** | `d` | |
| **ian** | `5` | | **ei** | `e` | |
| **uen** | `6` | | **ao** | `f` | |
| **iao** | `7` | | **ou** | `g` | |
| **uai** | `8` | | **an** | `h` | |
| **en** | `i` | | **in** | `j` | |
| **un** | `k` | | **vn** | `l` | 拼音的 `ün` 统一写为 `vn` |
| **ia** | `m` | | **ua** | `n` | |
| **uo** | `o` | | **ie** | `p` | |
| **ue** | `q` | 拼音的 `üe` 统一写为 `ue` | **ui** | `r` | |
| **er** | `s` | 儿化音/独立音节 | **a** | `t` | |
| **o** | `u` | | **e** | `v` | |
| **i** | `w` | 普通声母后的 `i` | **u** | `x` | |
| **v** | `y` | 拼音的 `ü` 统一写为 `v` | **van** | `B` | 拼音的 `üan` 统一写为 `van` |
| **i-flat** | `z` | 平舌音 (`z,c,s`) 后的 `i` | **i-retro** | `A` | 翘舌音 (`zh,ch,sh,r`) 后的 `i` |

> [!NOTE]
> 在早期的 `dict.txt` 生成时，平翘舌的 `i-flat` 和 `i-retro` 可能被统一记为了 `w`。不过在匹配校验算法中，系统会自动做互通扩展，但对于精准度来说，推荐在新的词库中直接对 `i-flat` 和 `i-retro` 进行隔离编码。

---

## 3. 核心拼音解析与特殊转换规则

为了保持词典编码与系统运行时的匹配键完全一致，解析拼音（去除声调后）需执行以下特殊转换：

1.  **声母提取**：
    从拼音最左侧匹配最长声母，声母优先级为：`zh, ch, sh, z, c, s, b, p, m, f, d, t, n, l, g, k, h, j, q, x, r, w, y`。剩余部分为韵母 `rest`。
2.  **ü / u 纠正**：
    如果声母是 `j, q, x, y` 之一：
    *   若韵母 `rest` 以 `u` 开头（如 `u`, `uan`, `ue` 等），则统一将 `u` 修正为 `v`（例如拼音 `ju` -> 实际韵母为 `v`，拼音 `xuan` -> 实际韵母为 `van`，拼音 `qun` -> 实际韵母为 `vn`）。
3.  **e / ie 纠正**：
    if 声母是 `j, q, x, y` 之一，且韵母 `rest` 是 `e`（如拼音 `jie`, `ye` 等），则统一将韵母修正为 `ie`。
4.  **y + an 纠正**：
    如果声母是 `y`，且韵母 `rest` 是 `an`（如拼音 `yan`），则将韵母修正为 `ian`。
5.  **i 韵隔离协议 (Triple-I Isolation)**：
    如果韵母 `rest` 为 `i`：
    *   若声母是 `z, c, s` 之一 -> 韵母转为 `i-flat` (编码为 `z`)。
    *   若声母是 `zh, ch, sh, r` 之一 -> 韵母转为 `i-retro` (编码为 `A`)。
    *   其他声母后的 `i` 保持为 `i` (编码为 `w`)。

---

## 4. 查询与匹配逻辑

当用户输入一个词查询押韵词时，系统在 [js/main.js](file:///d:/Documents/GitHub/FakerRhymes/js/main.js) 中执行如下操作：

### 4.1 生成查询变体键 (`queryDict`)
系统根据用户选择的**宽松度 (Looseness)**，将输入词的最后 $N$ 个字（默认为全字长）的拼音转化为多种可能的 Key 组合：

*   **Tier 0（严格模式）**：
    *   声调必须严格一致。
    *   韵母要求一致。**例外**：为了提高容错性，`i`, `i-flat`, `i-retro` 被视为可互通。
*   **Tier 1（通押模式）**：
    *   声调必须严格一致。
    *   韵母放宽到相同的“十三辙”分类中互通（例如 `an` 能够匹配 `ian`, `uan`, `van`）。
*   **Tier 2（谐音模式）**：
    *   忽略声调（系统会对每个字生成 1, 2, 3, 4 声的全部排列组合）。
    *   韵母放宽到相同的“十三辙”分类中。

#### 十三辙通押分组表
```javascript
const thirteenTracks = [
    { name: '发花辙', finals: ['a', 'ia', 'ua'] },
    { name: '梭波辙', finals: ['o', 'e', 'uo'] },
    { name: '乜斜辙', finals: ['ie', 'ue', 've'] },
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
```

### 4.2 正则检索与过滤
1.  **精确查询**：在 `dict.txt` 中用变体键直接匹配整行，得出相同字数的备选词。
2.  **后缀查询（更长词）**：当输入字数 $\ge 2$ 时，取其末尾字编码在 `dict.txt` 进行后缀正则匹配，找到以该韵律结尾的更长词组。
3.  **二次校验与声母互斥**：
    *   由于正则生成的匹配结果是并集，系统会在前端逐字校验其声调和韵母是否在当前 Tier 允许范围内。
    *   **声母互斥原则**：特殊摩擦声母（`zh, ch, sh, r, z, c, s`）与普通声母（如 `j, q, x`）具有极强的听感冲突。如果用户输入的词**不包含**特殊声母，而匹配词**包含**特殊声母，系统会强制将其排除，保护普通韵脚的和谐感（例如：“记忆”不会匹配到“基石”）。
4.  **平仄过滤**：根据用户选择的平仄对匹配词的**尾字**声调进行筛选：
    *   **平声**：1声、2声
    *   **仄声**：3声、4声

---

## 5. 如何导入新词典？

导入新词典的本质是：**读取你原有的新词词库，将它们逐个转换为系统的拼音编码 Key，然后与现有的 `dict.txt` 合并、去重、再排序输出。**

> [!CAUTION]
> 绝对不能直接使用重复的 Key 另起一行写入 `dict.txt`！因为前端采用正则匹配 `(?:^|\n)[Key]:([^\n]+)`，如果存在重复的 Key 行，正则只会匹配到第一个，导致新导入的词或旧词被漏掉。必须合并具有相同 Key 的词组。

### Python 词典导入与合并脚本
推荐使用 Python 的 `pypinyin` 库来实现自动化的转换和合并。你可以将以下脚本保存为 `merge_dict.py` 并在项目根目录下运行。

#### 1. 安装依赖
```bash
pip install pypinyin
```

#### 2. 脚本代码 (`merge_dict.py`)
```python
import os
import re
from pypinyin import pinyin, Style

# 1. 韵母到代号的映射表
FINAL_TO_CODE = {
    'iong': '0', 'uang': '1', 'iang': '2', 'ueng': '3', 'uan': '4', 'ian': '5', 'uen': '6', 'iao': '7', 'uai': '8',
    'ang': '9', 'eng': 'a', 'ing': 'b', 'ong': 'c', 'ai': 'd', 'ei': 'e', 'ao': 'f', 'ou': 'g', 'an': 'h', 'en': 'i',
    'in': 'j', 'un': 'k', 'vn': 'l', 'ia': 'm', 'ua': 'n', 'uo': 'o', 'ie': 'p', 'ue': 'q', 'ui': 'r', 'er': 's',
    'a': 't', 'o': 'u', 'e': 'v', 'i': 'w', 'u': 'x', 'v': 'y', 'van': 'B', 'i-flat': 'z', 'i-retro': 'A', 'ü': 'y'
}

INITIALS = ['zh', 'ch', 'sh', 'z', 'c', 's', 'b', 'p', 'm', 'f', 'd', 't', 'n', 'l', 'g', 'k', 'h', 'j', 'q', 'x', 'r', 'w', 'y']

def detect_final(pinyin_str):
    # 去除声调
    clean = re.sub(r'\d', '', pinyin_str).replace('ü', 'v').replace('u:', 'v')
    
    # 提取最长声母
    initial = ''
    for init in INITIALS:
        if clean.startswith(init):
            initial = init
            break
            
    rest = clean[len(initial):]
    
    # j/q/x/y 后的 u 实际是 ü (v)
    if initial in ['j', 'q', 'x', 'y'] and rest.startswith('u'):
        rest = 'v' + rest[1:]
        
    # j/q/x/y 后的 e 实际是 ie
    if initial in ['j', 'q', 'x', 'y'] and rest == 'e':
        rest = 'ie'
        
    # y 后的 an 实际是 ian
    if initial == 'y' and rest == 'an':
        rest = 'ian'
        
    # Triple-I Isolation
    if rest == 'i':
        if initial in ['z', 'c', 's']:
            return 'i-flat'
        elif initial in ['zh', 'ch', 'sh', 'r']:
            return 'i-retro'
            
    if not rest:
        return clean
        
    return rest

def get_word_key(word):
    """根据词语生成其对应的韵律 Key"""
    pinyins = pinyin(word, style=Style.TONE3, neutral_tone_with_five=True)
    key_parts = []
    
    for item in pinyins:
        raw_py = item[0].lower()
        # 提取声调
        tone_match = re.search(r'\d', raw_py)
        tone = tone_match.group(0) if tone_match else '0'
        if tone == '5': # 拼音库轻声可能返回5，统一转为0
            tone = '0'
            
        fin = detect_final(raw_py)
        code = FINAL_TO_CODE.get(fin)
        if not code:
            # 容错：如果映射不到，保留原拼音进行默认映射，或跳过
            return None
        key_parts.append(f"{code}{tone}")
        
    return "".join(key_parts)

def load_existing_dict(dict_path):
    """读取已有的 dict.txt 到内存字典"""
    data = {}
    if not os.path.exists(dict_path):
        return data
        
    with open(dict_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or ':' not in line:
                continue
            key, words_str = line.split(':', 1)
            words = [w.strip() for w in words_str.split(',') if w.strip()]
            if key in data:
                data[key].update(words)
            else:
                data[key] = set(words)
    return data

def import_new_words(existing_data, new_words_list):
    """将新词列表编码并并入已有字典"""
    success_count = 0
    fail_count = 0
    
    for word in new_words_list:
        word = word.strip()
        if not word or not re.match(r'^[\u4e00-\u9fa5]+$', word) or len(word) < 2:
            # 过滤非中文字符，或小于两个字的词（系统限制至少两字）
            fail_count += 1
            continue
            
        key = get_word_key(word)
        if not key:
            fail_count += 1
            continue
            
        if key in existing_data:
            existing_data[key].add(word)
        else:
            existing_data[key] = {word}
        success_count += 1
        
    print(f"新词转换完成：成功 {success_count} 个，过滤/失败 {fail_count} 个")

def save_dict(data, output_path):
    """保存字典到 dict.txt 并保持按 Key 字典序排序"""
    sorted_keys = sorted(data.keys())
    with open(output_path, 'w', encoding='utf-8', newline='\n') as f:
        for key in sorted_keys:
            words_str = ",".join(sorted(list(data[key])))
            f.write(f"{key}:{words_str}\n")
    print(f"新词典已成功保存至 {output_path}，当前共有 {len(sorted_keys)} 个唯一 Key 键。")

if __name__ == '__main__':
    dict_file = 'dict.txt' # 已有词典路径
    
    # 示例：你要导入的新词库（你可以改为从一个 txt 文件中读取）
    # 例如：with open('my_new_words.txt', 'r', encoding='utf-8') as f: new_words = f.read().splitlines()
    new_words = [
        "人工智能", "深度学习", "大语言模型", "双轮驱动", "自我突破"
    ]
    
    print("开始加载已有词典...")
    dict_data = load_existing_dict(dict_file)
    print(f"加载完成，当前已有 {len(dict_data)} 个 Key。")
    
    print("开始合并新词...")
    import_new_words(dict_data, new_words)
    
    print("保存合并后的新词典...")
    save_dict(dict_data, dict_file)
```

### 3. 后续验证
运行完合并脚本后：
1. 打开 FakerRhymes 网页（若是本地运行，推荐用 `python -m http.server 8080` 起静态服务）。
2. 在浏览器中搜索你新加入 the 词语（例如“人工智能”），验证是否能够成功展现押韵词。
3. 也可以在控制台运行如下命令检查性能指标是否在正常范围：
   ```javascript
   window.fakerRhymesPerformanceTests.runSearchLatencyTest('人工智能', 20)
   ```
