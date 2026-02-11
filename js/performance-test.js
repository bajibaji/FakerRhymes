// 文件: js/performance-test.js
// 描述: 根据 PERFORMANCE_TEST.md 文档要求，自动化测试词典检索延迟的脚本。
// 使用方法: 在浏览器控制台中运行 window.fakerRhymesPerformanceTests.runCoreTest() 
//         或 window.fakerRhymesPerformanceTests.runSearchLatencyTest('你的查询词', 次数)

(function () {
    // 确保全局对象提前定义，防止在控制台运行测试时出现 Uncaught TypeError
    window.fakerRhymesPerformanceTests = {};

    // 检查核心依赖函数是否可用
    function checkDependencies() {
        if (!window.toInfo || !window.queryDict || !window.loadDict) {
            console.error('? 性能测试依赖函数 (toInfo, queryDict, loadDict) 未加载。请确保 js/main.js 及其依赖 (如 pinyin-pro) 已成功载入。');
            return false;
        }
        return true;
    }

    // 辅助函数: 将词语转换成拼音信息数组 (Infos)
    function getInfos(phrase) {
        if (!window.toInfo) return [];
        return Array.from(phrase).map(window.toInfo).filter(Boolean);
    }

    /**
     * 运行检索延迟测试
     * @param {string} phrase - 用于查询的中文词语 (建议 3-4 字)
     * @param {number} testRuns - 重复运行次数
     */
    async function runSearchLatencyTest(phrase, testRuns = 10) {
        if (!checkDependencies()) return;

        const infos = getInfos(phrase);
        if (infos.length === 0) {
            console.error(`? 无法获取词语 "${phrase}" 的拼音信息，测试终止。`);
            return;
        }

        const results = [];
        // 定义测试模式和对应的 looseness 值 (松紧分级: 0, 1, 2)
        const testModes = [
            { name: '严格模式 (Tier 0)', looseness: 0.0, target: '< 50ms' },
            { name: '中等模式 (Tier 1)', looseness: 0.35, target: '< 200ms' },
            { name: '最松模式 (Tier 2)', looseness: 0.7, target: '< 200ms' }
        ];

        console.groupCollapsed(`? FakerRhymes 检索延迟性能测试: "${phrase}" (${testRuns}次重复)`);
        console.log(`查询词: ${phrase} (${infos.length}字), 拼音信息有效性: ${infos.length === Array.from(phrase).length ? '?' : '??'} (多音字可能导致信息丢失)`);

        for (const mode of testModes) {
            const times = [];
            let totalResults = 0;
            
            // 预热 (Warm-up): 确保数据已缓存/JIT优化
            await window.queryDict(infos, mode.looseness);

            for (let i = 0; i < testRuns; i++) {
                const start = performance.now();
                const result = await window.queryDict(infos, mode.looseness);
                const end = performance.now();
                const time = end - start;
                times.push(time);
                
                if (result) {
                    totalResults = Object.values(result).flat().length;
                }
            }

            const min = Math.min(...times);
            const max = Math.max(...times);
            const avg = times.reduce((a, b) => a + b, 0) / testRuns;
            
            results.push({
                模式: mode.name,
                目标: mode.target,
                平均耗时_ms: avg.toFixed(3),
                最快_ms: min.toFixed(3),
                最慢_ms: max.toFixed(3),
                结果总数: totalResults
            });
            
            console.log(`\n--- ${mode.name} (Looseness: ${mode.looseness}) ---`);
            console.log(`  平均耗时: ${avg.toFixed(3)} ms`);
            console.log(`  结果总数: ${totalResults} 个`);
        }
        
        console.groupEnd();
        
        // 使用 console.table 给出明确的数据收集分析
        console.table(results);
    }
    
    /**
     * 测量词库初始化耗时
     */
    async function measureDictLoadTime() {
        if (!checkDependencies()) return;

        console.log('\n--- 词库初始化耗时测试 (Dictionary Init) ---');
        if (window.dictLoaded) {
            console.warn('?? 词典已载入内存。该测试需要在清空浏览器缓存 (或强制重置 globalDictData) 后才能测出冷启动性能。');
            console.log('请运行 loadDict() 并查看控制台日志中 "词库全量载入内存耗时" 的输出。');
            return;
        }

        // loadDict() 内部有计时并输出，直接调用即可
        await window.loadDict();
        console.log('? 词库初始化已完成。请查看控制台日志中的 "词库全量载入内存耗时" 输出。');
    }
    
    // 将测试函数绑定到全局对象
    window.fakerRhymesPerformanceTests.runSearchLatencyTest = runSearchLatencyTest;
    window.fakerRhymesPerformanceTests.measureDictLoadTime = measureDictLoadTime;
    window.fakerRhymesPerformanceTests.runCoreTest = () => runSearchLatencyTest('人工智能', 50);

    console.log('? FakerRhymes 性能测试脚本 [`js/performance-test.js`](js/performance-test.js) 已载入。');
    console.log('请在控制台运行 `window.fakerRhymesPerformanceTests.runCoreTest()` 进行核心搜索延迟测试。');

})();