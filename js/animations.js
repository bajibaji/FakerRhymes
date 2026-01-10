// 开发模式开关（生产环境设为false以禁用console.log）
		const DEV_MODE = false;
		const devLog = (...args) => { if (DEV_MODE) console.log(...args); };
		
		// GSAP Animations
		document.addEventListener("DOMContentLoaded", () => {
			const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

			// 检查GSAP是否加载成功
			if (typeof gsap === 'undefined') {
				console.warn('GSAP未加载，跳过动画');
				return;
			}
			if (reduceMotion) {
				window.triggerResultAnimation = () => {};
				return;
			}
			gsap.config({ nullTargetWarn: false });

			// 将动画逻辑包装在一个函数中，供加载完成后调用
			window.startMainAnimations = () => {
				// 如果已经在运行了，直接返回
				if (window.isAnimationsStarted) return;
				window.isAnimationsStarted = true;

				// 1. Background Blobs Floating
				gsap.to(".blob-1", {
					x: "20%", y: "20%", duration: 8, repeat: -1, yoyo: true, ease: "sine.inOut"
				});
				gsap.to(".blob-2", {
					x: "-20%", y: "-20%", duration: 10, repeat: -1, yoyo: true, ease: "sine.inOut", delay: 1
				});
				gsap.to(".blob-3", {
					x: "15%", y: "-15%", scale: 1.2, duration: 12, repeat: -1, yoyo: true, ease: "sine.inOut", delay: 2
				});

				// 2. Entry Animations
				const tl = gsap.timeline({ defaults: { ease: "power3.out" } });

				tl.to(".shell", {
					y: 0,
					opacity: 1,
					duration: 1,
					startAt: { y: 30, opacity: 0 },
					clearProps: "all"
				})
				tl.to("header h1", {
					y: 0,
					opacity: 1,
					duration: 0.4,
					startAt: { y: 20, opacity: 0 }
				}, "-=0.8")
				.to("header .subtitle", {
					y: 0,
					opacity: 1,
					duration: 0.2,
					startAt: { y: 10, opacity: 0 }
				}, "-=0.6")
				.to(".panel", {
					y: 0,
					opacity: 1,
					duration: 0.1,
					stagger: 0.15,
					startAt: { y: 30, opacity: 0 },
					clearProps: "all"
				}, "-=0.6")
				.to(".footer", {
					opacity: 1,
					duration: 1,
					startAt: { opacity: 0 },
					clearProps: "all"
				}, "-=0.4");
			};

		// 3. Interactive Elements
		const buttons = document.querySelectorAll(".btn");
		buttons.forEach((btn) => {
			btn.addEventListener("mouseenter", () => {
				gsap.to(btn, { scale: 1.03, duration: 0.22, ease: "power3.out" });
			});
			btn.addEventListener("mouseleave", () => {
				gsap.to(btn, { scale: 1, duration: 0.18, ease: "power2.out" });
			});
			btn.addEventListener("mousedown", () => {
				gsap.to(btn, { scale: 0.98, duration: 0.12, ease: "power2.out" });
			});
			btn.addEventListener("mouseup", () => {
				gsap.to(btn, { scale: 1.02, duration: 0.22, ease: "power3.out" });
				if (navigator.vibrate) navigator.vibrate(10);
			});
			btn.addEventListener("touchstart", () => {
				if (navigator.vibrate) navigator.vibrate(5);
			}, { passive: true });
		});
		
		// Animate output when generated
		window.triggerResultAnimation = () => {
			if (typeof gsap === 'undefined') return;
			gsap.fromTo("#output", { opacity: 0.45, y: 6, filter: 'blur(6px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.5, ease: "power2.out", clearProps: 'filter' });
			gsap.fromTo("#badges", { opacity: 0, x: -10 }, { opacity: 1, x: 0, duration: 0.4, delay: 0.1, ease: "power2.out" });
			// Table rows animation
			setTimeout(() => {
				gsap.from("#detailBody tr", {
					opacity: 0,
					x: -10,
					stagger: 0.05,
					duration: 0.4,
					ease: "power2.out",
					clearProps: "all"
				});
			}, 50);

			// Matched results flow
			const matchedResults = document.getElementById('matchedResults');
			const items = document.querySelectorAll('#matchedResultsList .match-item');
			if (matchedResults && matchedResults.style.display !== 'none' && items.length) {
				gsap.fromTo(matchedResults, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.35, ease: 'power2.out', clearProps: 'all' });
				gsap.fromTo(items, { opacity: 0, y: 8, scale: 0.98 }, { opacity: 1, y: 0, scale: 1, duration: 0.35, stagger: 0.03, ease: 'power2.out', clearProps: 'transform' });
			}

			// Mobile: Scroll to result
			if (window.innerWidth <= 900) {
				setTimeout(() => {
					document.querySelector('.panel:nth-of-type(2)').scrollIntoView({ behavior: 'smooth', block: 'start' });
				}, 100);
			}
		};

		const goBtn = document.getElementById('go');
		goBtn.addEventListener('click', () => {
			window.triggerResultAnimation();
		});
	});