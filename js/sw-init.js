// 在本地开发环境（localhost/127.0.0.1）不注册 Service Worker，避免干扰 Live Preview
		if ('serviceWorker' in navigator && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
			window.addEventListener('load', () => {
				navigator.serviceWorker.register('./js/service-worker.js').catch((err) => {
					console.warn('Service worker registration failed', err);
				});
			});
		}