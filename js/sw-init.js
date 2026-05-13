// 在本地开发环境（localhost/127.0.0.1）不注册 Service Worker，避免干扰 Live Preview
		if ('serviceWorker' in navigator && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
			window.addEventListener('load', () => {
				navigator.serviceWorker.register('./service-worker.js', {
					updateViaCache: 'none' // 强制每次都从网络获取 SW 及其 importScripts，不走 HTTP 缓存
				}).then((reg) => {
					// 每次页面加载时主动检查 SW 是否有更新
					reg.update().catch(() => {});

					// 监听：当新 SW 安装完毕并进入 waiting 状态时，自动激活并刷新页面
					reg.addEventListener('updatefound', () => {
						const newWorker = reg.installing;
						if (!newWorker) return;
						newWorker.addEventListener('statechange', () => {
							if (newWorker.state === 'activated') {
								console.log('[SW] 新版本已激活，刷新页面...');
								window.location.reload();
							}
						});
					});
				}).catch((err) => {
					console.warn('Service worker registration failed', err);
				});
			});
		}
