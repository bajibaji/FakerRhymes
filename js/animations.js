/**
 * 界面美化动画脚本
 * 包含：粒子背景系统、按钮涟漪效果、结果展示动画
 */

// =========================================
// 粒子背景系统
// =========================================
class ParticleSystem {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    
    this.ctx = this.canvas.getContext('2d');
    this.particles = [];
    this.particleCount = 50;
    this.mouseX = 0;
    this.mouseY = 0;
    
    this.resize();
    this.init();
    this.animate();
    
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    });
  }
  
  resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }
  
  init() {
    for (let i = 0; i < this.particleCount; i++) {
      this.particles.push({
        x: Math.random() * this.canvas.width,
        y: Math.random() * this.canvas.height,
        size: Math.random() * 2 + 0.5,
        speedX: (Math.random() - 0.5) * 0.5,
        speedY: (Math.random() - 0.5) * 0.5,
        opacity: Math.random() * 0.5 + 0.2,
        color: Math.random() > 0.5 ? '#8b5cf6' : '#06b6d4'
      });
    }
  }
  
  animate() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
    this.particles.forEach(p => {
      p.x += p.speedX;
      p.y += p.speedY;
      
      if (p.x < 0) p.x = this.canvas.width;
      if (p.x > this.canvas.width) p.x = 0;
      if (p.y < 0) p.y = this.canvas.height;
      if (p.y > this.canvas.height) p.y = 0;
      
      const dx = this.mouseX - p.x;
      const dy = this.mouseY - p.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance < 150) {
        const force = (150 - distance) / 150;
        p.x -= dx * force * 0.02;
        p.y -= dy * force * 0.02;
      }
      
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      this.ctx.fillStyle = p.color;
      this.ctx.globalAlpha = p.opacity;
      this.ctx.fill();
    });
    
    this.drawConnections();
    this.ctx.globalAlpha = 1;
    requestAnimationFrame(() => this.animate());
  }
  
  drawConnections() {
    for (let i = 0; i < this.particles.length; i++) {
      for (let j = i + 1; j < this.particles.length; j++) {
        const dx = this.particles[i].x - this.particles[j].x;
        const dy = this.particles[i].y - this.particles[j].y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance < 120) {
          this.ctx.beginPath();
          this.ctx.moveTo(this.particles[i].x, this.particles[i].y);
          this.ctx.lineTo(this.particles[j].x, this.particles[j].y);
          this.ctx.strokeStyle = 'rgba(124, 58, 237, 0.1)';
          this.ctx.lineWidth = 0.5;
          this.ctx.stroke();
        }
      }
    }
  }
}

// =========================================
// 按钮涟漪效果
// =========================================
function initRippleEffect() {
  document.querySelectorAll('.btn').forEach(btn => {
    btn.addEventListener('click', function(e) {
      const rect = this.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      const ripple = document.createElement('span');
      ripple.className = 'ripple';
      ripple.style.left = x + 'px';
      ripple.style.top = y + 'px';
      
      this.appendChild(ripple);
      setTimeout(() => ripple.remove(), 600);
    });
  });
}

// =========================================
// 结果展示动画 (仪式感核心)
// =========================================
/**
 * 触发结果面板的进入动画和滚动
 * @param {boolean} isIncremental 是否为增量更新。若是，则不触发滚动，且仅对新元素执行动画。
 */
function triggerResultAnimation(isIncremental = false) {
  const output = document.getElementById('output');
  const panel = document.getElementById('resultsPanel') || (output ? output.closest('.panel') : null);
  const looseness = parseFloat(document.getElementById('looseness')?.value || '0');
  
  if (!output || !panel) return;

  // 1. 视角滚动：仅在非增量模式（即第一次渲染）时执行，避免“锁定用户视角”
  if (!isIncremental) {
    const doScroll = () => {
      const yOffset = -30;
      const rect = panel.getBoundingClientRect();
      const targetY = rect.top + window.pageYOffset + yOffset;
      window.scrollTo({ top: targetY, behavior: 'smooth' });
    };
    // 延迟执行，确保布局稳定
    setTimeout(doScroll, 250);
  }

  // 2. 动画逻辑处理
  const animateElements = (forceAll = false) => {
    const allSpans = Array.from(output.querySelectorAll('span'));
    
    // 如果是最松模式 (looseness >= 1)，禁用逐个显示动画，直接显示
    if (looseness >= 1.0) {
      allSpans.forEach(el => {
        el.style.display = 'inline-block';
        el.style.opacity = el.dataset.targetOpacity || el.style.opacity || '1';
        el.style.transform = 'none';
        el.style.filter = 'none';
        el.style.transition = 'none';
        el.dataset.shown = 'true';
      });
      return;
    }

    // 找出真正需要动画的新元素（未标记 shown 的）
    const itemsToAnimate = forceAll ? allSpans : allSpans.filter(el => el.dataset.shown !== 'true');
    if (itemsToAnimate.length === 0) return;

    // 优先使用 GSAP 实现有阻尼弹性的 stagger 缓入动画
    if (window.gsap) {
      itemsToAnimate.forEach(el => {
        if (!el.dataset.targetOpacity) {
          const inlineOpacity = el.style.opacity;
          el.dataset.targetOpacity = inlineOpacity && inlineOpacity !== '0' ? inlineOpacity : '1';
        }
        el.style.display = 'inline-block';
        el.dataset.shown = 'true';
      });

      window.gsap.fromTo(itemsToAnimate,
        { opacity: 0, y: 15, scale: 0.95, filter: 'blur(5px)' },
        {
          opacity: (i, el) => el.dataset.targetOpacity,
          y: 0,
          scale: 1,
          filter: 'blur(0px)',
          duration: 0.45,
          ease: 'power2.out',
          stagger: {
            each: Math.max(0.01, Math.min(0.04, 0.8 / allSpans.length))
          }
        }
      );
      return;
    }

    // 降级：仅重置新元素的初始状态，不要触碰已显示的元素！
    itemsToAnimate.forEach(el => {
      if (!el.dataset.targetOpacity) {
        const inlineOpacity = el.style.opacity;
        el.dataset.targetOpacity = inlineOpacity && inlineOpacity !== '0' ? inlineOpacity : '1';
      }
      
      el.style.display = 'inline-block';
      el.style.opacity = '0';
      el.style.transform = 'translateY(15px) scale(0.95)';
      el.style.filter = 'blur(10px)';
      el.style.transition = 'none';
    });

    // 强制回流
    output.offsetHeight;

    // 逐个触发新元素的动画
    let accumulatedDelay = 0;
    // 确定当前动画队列在总列表中的起始偏移，用于计算 baseStep
    const startIndex = allSpans.indexOf(itemsToAnimate[0]);

    itemsToAnimate.forEach((el, i) => {
      const globalIndex = startIndex + i;
      const baseStep = Math.max(30, Math.min(80, 1500 / allSpans.length));
      const currentStep = globalIndex < 25 ? baseStep : 5;
      
      const t = setTimeout(() => {
        el.style.transition = 'all 0.6s cubic-bezier(0.16, 1, 0.3, 1)';
        el.style.opacity = el.dataset.targetOpacity;
        el.style.transform = 'translateY(0) scale(1)';
        el.style.filter = 'blur(0)';
        el.dataset.shown = 'true'; // 动画完成后标记
      }, accumulatedDelay);
      
      accumulatedDelay += currentStep;
      if (!window._rhymeTimers) window._rhymeTimers = [];
      window._rhymeTimers.push(t);
    });
  };

  // 初始执行（对当前存在的元素）
  animateElements(!isIncremental);

  // 3. 使用 MutationObserver 增量处理未来加入的节点 (AI 模式或后续追加)
  if (!window._rhymeObs) {
    window._rhymeObs = new MutationObserver((mutations) => {
      const hasNewNodes = mutations.some(m => m.addedNodes.length > 0);
      if (hasNewNodes) {
        animateElements(false);
      }
    });
    window._rhymeObs.observe(output, { childList: true });
  }

  // 4. 新增：监听 `matchedResultsList` 气泡的载入，赋予 stagger 动效
  const matchedList = document.getElementById('matchedResultsList');
  if (matchedList && !window._matchedListObs) {
    window._matchedListObs = new MutationObserver((mutations) => {
      const addedNodes = [];
      mutations.forEach(m => {
        m.addedNodes.forEach(node => {
          if (node.classList && node.classList.contains('match-item')) {
            addedNodes.push(node);
          }
        });
      });
      
      if (addedNodes.length > 0) {
        if (window.gsap) {
          window.gsap.fromTo(addedNodes, 
            { opacity: 0, y: 15, scale: 0.95 },
            { opacity: 1, y: 0, scale: 1, duration: 0.4, ease: 'back.out(1.2)', stagger: 0.005 }
          );
        } else {
          // 降级使用 CSS 延迟动画
          addedNodes.forEach((node, i) => {
            node.style.opacity = '0';
            node.style.transform = 'translateY(10px) scale(0.95)';
            node.style.transition = 'none';
            setTimeout(() => {
              node.style.transition = 'all 0.4s cubic-bezier(0.16, 1, 0.3, 1)';
              node.style.opacity = '1';
              node.style.transform = 'translateY(0) scale(1)';
            }, i * 15);
          });
        }
      }
    });
    window._matchedListObs.observe(matchedList, { childList: true });
  }
}

// 停止并清理所有正在运行的动画
function stopAllRhymeAnimations() {
  if (window._rhymeTimers) {
    window._rhymeTimers.forEach(clearTimeout);
    window._rhymeTimers = [];
  }
  
  const output = document.getElementById('output');
  if (output && window.gsap) {
    const allSpans = Array.from(output.querySelectorAll('span'));
    window.gsap.killTweensOf(allSpans);
  }
  
  const matchedList = document.getElementById('matchedResultsList');
  if (matchedList && window.gsap) {
    const allItems = Array.from(matchedList.querySelectorAll('.match-item'));
    window.gsap.killTweensOf(allItems);
  }
}

// 暴露接口
window.triggerResultAnimation = triggerResultAnimation;
window.stopAllRhymeAnimations = stopAllRhymeAnimations;

// =========================================
// 初始化
// =========================================
document.addEventListener('DOMContentLoaded', () => {
  // 移动端禁用耗能动画
  if (window.innerWidth > 768) {
    new ParticleSystem('particles-canvas');
  }
  initRippleEffect();
});
