// 简单常用字库（覆盖多种韵母与声调），可自行扩展
(function () {
  // 将自定义词或字填到 customBank 数组，可写多字符词或单字；
  // 例如: '北京', '程序员', '飞'。每个字符都会被单独取拼音参与押韵。
  const customBank = [
    // 在此添加你的自定义词/字，例如：
    // '北京', '程序员', '飞'
  ];

  // 内置常用字表
  const bank = [
    
  ];

  const readLocalCustom = () => {
    if (!window.localStorage) return [];
    try {
      const raw = localStorage.getItem('CUSTOM_RHYME_BANK');
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch (e) {
      return [];
    }
  };

  const readOnlineDict = () => {
    if (!window.localStorage) return [];
    try {
      const raw = localStorage.getItem('ONLINE_DICT_CACHE');
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch (e) {
      return [];
    }
  };

  const uniqueMerge = (...lists) => {
    const set = new Set();
    lists.flat().forEach((item) => {
      if (item) set.add(item);
    });
    return Array.from(set);
  };

  const getRhymeBank = () => uniqueMerge(bank, customBank, readLocalCustom(), readOnlineDict());

  window.getRhymeBank = getRhymeBank;
  window.RHYME_CHAR_BANK = getRhymeBank();
  window.refreshRhymeBank = () => {
    window.RHYME_CHAR_BANK = getRhymeBank();
    return window.RHYME_CHAR_BANK;
  };
})();
