/**
 * 视觉效果控制模块 - 实现高级感视觉效果
 * @module visual-effects
 * 
 * 包含三个核心效果：
 * A. 毛玻璃效果 (Glassmorphism) - 通过 CSS 实现
 * B. 智能光效跟随 (Spotlight Effect) - 鼠标跟随光晕
 * C. 窗口无缝过渡 - 惯性动画效果
 */

const VisualEffects = (function() {
  'use strict';

  // 配置项
  const CONFIG = {
    spotlightSelector: '.panel',
    enableBorderGlow: false,
    enableInertiaScroll: false,
    throttleMs: 16, // ~60fps
  };

  // 检测是否偏好减少动画
  const prefersReducedMotion = window.matchMedia(
    '(prefers-reduced-motion: reduce)'
  ).matches;

  // 节流标志
  let ticking = false;

  /**
   * 初始化光效跟随效果
   * @param {string} selector - 目标元素选择器
   */
  function initSpotlight(selector = CONFIG.spotlightSelector) {
    if (prefersReducedMotion) {
      console.log('[VisualEffects] 用户偏好减少动画，跳过光效初始化');
      return;
    }

    const elements = document.querySelectorAll(selector);
    
    elements.forEach(el => {
      // 初始化 CSS 变量
      el.style.setProperty('--spotlight-x', '50%');
      el.style.setProperty('--spotlight-y', '50%');
      
      el.addEventListener('mousemove', handleMouseMove, { passive: true });
      el.addEventListener('mouseleave', handleMouseLeave, { passive: true });
      el.addEventListener('mouseenter', handleMouseEnter, { passive: true });
    });

    console.log(`[VisualEffects] 光效跟随已初始化，共 ${elements.length} 个元素`);
  }

  /**
   * 处理鼠标移动事件（带节流）
   * @param {MouseEvent} e 
   */
  function handleMouseMove(e) {
    const el = this;
    
    if (!ticking) {
      requestAnimationFrame(() => {
        const rect = el.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        el.style.setProperty('--spotlight-x', `${x}px`);
        el.style.setProperty('--spotlight-y', `${y}px`);
        
        ticking = false;
      });
      ticking = true;
    }
  }

  /**
   * 处理鼠标进入事件
   */
  function handleMouseEnter() {
    this.classList.add('spotlight-active');
  }

  /**
   * 处理鼠标离开事件
   */
  function handleMouseLeave() {
    this.classList.remove('spotlight-active');
    // 平滑重置到中心
    this.style.setProperty('--spotlight-x', '50%');
    this.style.setProperty('--spotlight-y', '50%');
  }

  /**
   * 初始化边框光晕效果（可选增强）
   * @param {string} selector 
   */
  function initBorderGlow(selector = CONFIG.spotlightSelector) {
    if (prefersReducedMotion || !CONFIG.enableBorderGlow) return;

    const elements = document.querySelectorAll(selector);
    
    elements.forEach(el => {
      // 检查是否已有光晕边框
      if (el.querySelector('.glow-border')) return;
      
      // 创建光晕边框容器
      const glowBorder = document.createElement('div');
      glowBorder.className = 'glow-border';
      el.style.position = 'relative';
      el.appendChild(glowBorder);
      
      el.addEventListener('mousemove', (e) => {
        const rect = el.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        requestAnimationFrame(() => {
          glowBorder.style.setProperty('--glow-x', `${x}px`);
          glowBorder.style.setProperty('--glow-y', `${y}px`);
        });
      }, { passive: true });
    });

    console.log('[VisualEffects] 边框光晕已初始化');
  }

  /**
   * 初始化惯性滚动效果（可选）
   */
  function initInertiaScroll() {
    if (prefersReducedMotion || !CONFIG.enableInertiaScroll) return;

    let velocity = 0;
    let currentY = 0;
    const friction = 0.92;
    const sensitivity = 0.3;
    
    const container = document.querySelector('.shell');
    if (!container) return;

    // 获取初始滚动位置
    currentY = container.scrollTop;
    
    container.addEventListener('wheel', (e) => {
      e.preventDefault();
      velocity += e.deltaY * sensitivity;
    }, { passive: false });
    
    function animate() {
      if (Math.abs(velocity) > 0.5) {
        velocity *= friction;
        currentY += velocity;
        
        // 边界限制
        const maxScroll = container.scrollHeight - container.clientHeight;
        currentY = Math.max(0, Math.min(currentY, maxScroll));
        
        container.scrollTop = currentY;
      }
      
      requestAnimationFrame(animate);
    }
    
    animate();
    console.log('[VisualEffects] 惯性滚动已初始化');
  }

  /**
   * 增强 Modal 过渡效果
   */
  function enhanceModalTransitions() {
    const modals = document.querySelectorAll('.modal-overlay');
    
    modals.forEach(overlay => {
      const modal = overlay.querySelector('.modal');
      if (!modal) return;

      // 监听 class 变化来触发动画
      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          if (mutation.attributeName === 'class') {
            const isActive = overlay.classList.contains('active');
            if (isActive && window.gsap) {
              // 使用 GSAP 增强进入动画
              gsap.fromTo(modal, 
                { 
                  y: 40, 
                  scale: 0.95, 
                  opacity: 0 
                },
                { 
                  y: 0, 
                  scale: 1, 
                  opacity: 1, 
                  duration: 0.4, 
                  ease: 'power3.out' 
                }
              );
            }
          }
        });
      });

      observer.observe(overlay, { attributes: true });
    });

    console.log('[VisualEffects] Modal 过渡增强已初始化');
  }

  /**
   * 添加 GPU 加速提示
   */
  function enableGPUAcceleration() {
    const elements = document.querySelectorAll('.panel, .shell, .modal');
    elements.forEach(el => {
      el.style.willChange = 'transform, opacity';
      el.style.transform = 'translateZ(0)';
    });
    console.log('[VisualEffects] GPU 加速已启用');
  }

  /**
   * 清理效果（用于销毁时）
   */
  function cleanup() {
    const elements = document.querySelectorAll(CONFIG.spotlightSelector);
    elements.forEach(el => {
      el.removeEventListener('mousemove', handleMouseMove);
      el.removeEventListener('mouseleave', handleMouseLeave);
      el.removeEventListener('mouseenter', handleMouseEnter);
      el.classList.remove('spotlight-active');
    });
    console.log('[VisualEffects] 效果已清理');
  }

  /**
   * 主初始化函数
   * @param {Object} options - 配置选项
   */
  function init(options = {}) {
    // 合并配置
    Object.assign(CONFIG, options);

    if (prefersReducedMotion) {
      console.log('[VisualEffects] 检测到用户偏好减少动画，部分效果已禁用');
    }

    // 等待 DOM 完全加载
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        initSpotlight();
        initBorderGlow();
        initInertiaScroll();
        enhanceModalTransitions();
        enableGPUAcceleration();
      });
    } else {
      initSpotlight();
      initBorderGlow();
      initInertiaScroll();
      enhanceModalTransitions();
      enableGPUAcceleration();
    }

    console.log('[VisualEffects] 视觉效果模块已初始化');
  }

  // 公开 API
  return {
    init,
    initSpotlight,
    initBorderGlow,
    initInertiaScroll,
    enhanceModalTransitions,
    enableGPUAcceleration,
    cleanup,
    CONFIG
  };
})();

// 导出模块
if (typeof window !== 'undefined') {
  window.VisualEffects = VisualEffects;
}
