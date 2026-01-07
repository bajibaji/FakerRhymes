/**
 * 启动屏幕控制器
 * 管理加载进度和启动屏幕生命周期
 * @module splash-controller
 */

(function() {
    'use strict';

    /**
     * 加载阶段定义
     */
    const stages = {
        INIT: { progress: 0, message: '正在初始化...' },
        CSS_LOADED: { progress: 15, message: '加载样式...' },
        CORE_SCRIPTS: { progress: 30, message: '加载核心脚本...' },
        PINYIN_LOADED: { progress: 45, message: '加载拼音引擎...' },
        VANTA_LOADED: { progress: 60, message: '初始化 3D 背景...' },
        GSAP_LOADED: { progress: 75, message: '加载动画库...' },
        DICT_LOADED: { progress: 90, message: '加载词库...' },
        COMPLETE: { progress: 100, message: '准备就绪' }
    };

    let currentStage = 'INIT';
    let isHidden = false;

    /**
     * 更新进度条
     * @param {string} stage - 阶段名称
     */
    const updateProgress = (stage) => {
        if (isHidden) return;
        
        currentStage = stage;
        const stageInfo = stages[stage];
        
        if (!stageInfo) {
            console.warn('[Splash] 未知阶段:', stage);
            return;
        }

        const { progress, message } = stageInfo;
        
        const progressBar = document.getElementById('splash-progress-bar');
        const statusText = document.getElementById('splash-status');
        
        if (progressBar) {
            progressBar.style.width = progress + '%';
        }
        
        if (statusText) {
            statusText.textContent = message;
        }
        
        console.log(`[Splash] ${stage}: ${progress}% - ${message}`);
    };

    /**
     * 设置自定义进度（用于细粒度控制）
     * @param {number} percent - 进度百分比 (0-100)
     * @param {string} message - 状态消息
     */
    const setProgress = (percent, message) => {
        if (isHidden) return;
        
        const progressBar = document.getElementById('splash-progress-bar');
        const statusText = document.getElementById('splash-status');
        
        if (progressBar) {
            progressBar.style.width = Math.min(100, Math.max(0, percent)) + '%';
        }
        
        if (statusText && message) {
            statusText.textContent = message;
        }
    };

    /**
     * 隐藏启动屏幕
     * @param {Function} callback - 隐藏完成后的回调
     */
    const hide = (callback) => {
        if (isHidden) return;
        isHidden = true;
        
        const splash = document.getElementById('splash-screen');
        if (!splash) {
            // 移除 splash-active 类，恢复滚动条
            document.documentElement.classList.remove('splash-active');
            if (callback) callback();
            return;
        }
        
        // 添加淡出类
        splash.classList.add('fade-out');
        
        // 等待动画完成后移除元素
        const onTransitionEnd = () => {
            splash.removeEventListener('transitionend', onTransitionEnd);
            splash.remove();
            // 移除 splash-active 类，恢复滚动条
            document.documentElement.classList.remove('splash-active');
            console.log('[Splash] 启动屏幕已移除');
            if (callback) callback();
        };
        
        splash.addEventListener('transitionend', onTransitionEnd);
        
        // 备用：如果 transitionend 没有触发，500ms 后强制移除
        setTimeout(() => {
            if (document.getElementById('splash-screen')) {
                splash.remove();
                // 移除 splash-active 类，恢复滚动条
                document.documentElement.classList.remove('splash-active');
                console.log('[Splash] 启动屏幕已强制移除');
                if (callback) callback();
            }
        }, 600);
    };

    /**
     * 显示错误状态
     * @param {string} errorMessage - 错误消息
     */
    const showError = (errorMessage) => {
        const statusText = document.getElementById('splash-status');
        const progressBar = document.getElementById('splash-progress-bar');
        
        if (statusText) {
            statusText.textContent = errorMessage || '加载失败，请刷新重试';
            statusText.style.color = '#ef4444';
        }
        
        if (progressBar) {
            progressBar.style.background = 'linear-gradient(90deg, #ef4444, #f87171)';
        }
    };

    /**
     * 检查启动屏幕是否存在
     * @returns {boolean}
     */
    const isVisible = () => {
        return !isHidden && document.getElementById('splash-screen') !== null;
    };

    // 导出模块
    window.SplashController = {
        stages,
        updateProgress,
        setProgress,
        hide,
        showError,
        isVisible,
        getCurrentStage: () => currentStage
    };

    console.log('[Splash] 控制器已初始化');
})();
