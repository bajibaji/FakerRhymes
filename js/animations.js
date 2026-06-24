/**
 * 界面美化动画脚本
 * 包含：粒子背景系统、按钮涟漪效果、结果展示动画
 */

// =========================================
// 粒子背景系统
// =========================================
/**
 * FakerRhymes 高性能 GSAP 动画控制中心
 * 移除了耗电的 Canvas 粒子，全面采用 GSAP 硬件加速动画
 */

// =========================================
// 1. 背景漂浮动画 (Blobs Floating)
// =========================================
function initBackgroundBlobs() {
  if (!window.gsap) return;
  gsap.to(".blob-1", {
    x: "20%", y: "15%", duration: 8, repeat: -1, yoyo: true, ease: "sine.inOut"
  });
  gsap.to(".blob-2", {
    x: "-15%", y: "-20%", duration: 10, repeat: -1, yoyo: true, ease: "sine.inOut", delay: 0.5
  });
  gsap.to(".blob-3", {
    x: "10%", y: "-10%", scale: 1.15, duration: 12, repeat: -1, yoyo: true, ease: "sine.inOut", delay: 1
  });
}

// =========================================
// 2. 页面与面板入场动画 (Entrance Transitions)
// =========================================
let entranceRun = false;
function startMainAnimations() {
  if (entranceRun || !window.gsap) return;
  entranceRun = true;
  gsap.config({ nullTargetWarn: false });

  const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
  tl.from(".shell", {
    y: 25,
    opacity: 0,
    duration: 1.0,
    clearProps: "all"
  })
  .from("header h1", {
    y: 15,
    opacity: 0,
    duration: 0.6
  }, "-=0.7")
  .from("header .subtitle", {
    y: 10,
    opacity: 0,
    duration: 0.6
  }, "-=0.5")
  .from(".panel", {
    y: 20,
    opacity: 0,
    duration: 0.6,
    stagger: 0.1
  }, "-=0.5");
}

// =========================================
// 3. 按钮与选项卡交互微动 (Micro-interactions)
// =========================================
function initInteractiveAnimations() {
  if (!window.gsap) return;

  // 使用事件委托或者直接绑定，让悬停与按下手感更具弹性反馈
  document.addEventListener("mouseenter", (e) => {
    const btn = e.target.closest(".btn, .segment-btn, .help-btn, .clear-btn");
    if (!btn) return;
    gsap.to(btn, { scale: 1.05, duration: 0.3, ease: "back.out(1.7)" });
  }, true);

  document.addEventListener("mouseleave", (e) => {
    const btn = e.target.closest(".btn, .segment-btn, .help-btn, .clear-btn");
    if (!btn) return;
    gsap.to(btn, { scale: 1, duration: 0.3, ease: "power2.out" });
  }, true);

  document.addEventListener("mousedown", (e) => {
    const btn = e.target.closest(".btn, .segment-btn, .help-btn, .clear-btn");
    if (!btn) return;
    gsap.to(btn, { scale: 0.94, duration: 0.1, ease: "power1.out" });
  }, true);

  document.addEventListener("mouseup", (e) => {
    const btn = e.target.closest(".btn, .segment-btn, .help-btn, .clear-btn");
    if (!btn) return;
    gsap.to(btn, { scale: 1.05, duration: 0.4, ease: "elastic.out(1, 0.3)" });
  }, true);
}

// =========================================
// 4. 结果展示弹性气泡动画 (Elastic Stagger)
// =========================================
function triggerResultAnimation(isIncremental = false) {
  const output = document.getElementById("output");
  const panel = document.getElementById("resultsPanel");
  if (!output || !panel) return;

  // 1. 视角平滑滚动（首次生成结果时触发，不锁定增量视角）
  if (!isIncremental) {
    setTimeout(() => {
      const rect = panel.getBoundingClientRect();
      window.scrollTo({ top: rect.top + window.pageYOffset - 30, behavior: "smooth" });
    }, 150);
  }

  // 2. 气泡词汇卡片弹性 Stagger 渐现
  if (!window.gsap) {
    // 降级：若 GSAP 未载入，直接显示
    output.querySelectorAll("span").forEach(el => el.style.opacity = "1");
    return;
  }

  const spans = Array.from(output.querySelectorAll("span")).filter(el => el.dataset.shown !== "true");
  if (spans.length === 0) return;

  spans.forEach(el => {
    el.style.display = "inline-block";
    el.dataset.shown = "true";
  });

  gsap.fromTo(spans,
    { opacity: 0, y: 15, scale: 0.8, filter: "blur(3px)" },
    {
      opacity: 1,
      y: 0,
      scale: 1,
      filter: "blur(0px)",
      duration: 0.4,
      ease: "back.out(1.4)",
      stagger: {
        each: Math.max(0.005, Math.min(0.03, 0.4 / spans.length))
      }
    }
  );

  // 3. 气泡“更多匹配结果”动画
  const matchedList = document.getElementById("matchedResultsList");
  if (matchedList) {
    const items = Array.from(matchedList.querySelectorAll(".match-item")).filter(el => el.dataset.shown !== "true");
    if (items.length > 0) {
      items.forEach(el => {
        el.style.display = "inline-block";
        el.dataset.shown = "true";
      });
      gsap.fromTo(items,
        { opacity: 0, y: 12, scale: 0.85 },
        { opacity: 1, y: 0, scale: 1, duration: 0.35, ease: "back.out(1.3)", stagger: 0.003 }
      );
    }
  }
}

// 停止并清理正在运行的动画
function stopAllRhymeAnimations() {
  if (!window.gsap) return;
  const output = document.getElementById("output");
  if (output) {
    const allSpans = Array.from(output.querySelectorAll("span"));
    gsap.killTweensOf(allSpans);
  }
  const matchedList = document.getElementById("matchedResultsList");
  if (matchedList) {
    const allItems = Array.from(matchedList.querySelectorAll(".match-item"));
    gsap.killTweensOf(allItems);
  }
}

// 暴露全局 API
window.triggerResultAnimation = triggerResultAnimation;
window.stopAllRhymeAnimations = stopAllRhymeAnimations;
window.startMainAnimations = startMainAnimations;

// 初始化
document.addEventListener("DOMContentLoaded", () => {
  initBackgroundBlobs();
  initInteractiveAnimations();
});
