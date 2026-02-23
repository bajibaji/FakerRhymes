const helpTriggerBtn = document.getElementById('helpTriggerBtn');
		const helpModalOverlay = document.getElementById('helpModalOverlay');
		const helpCloseBtn = document.getElementById('helpCloseBtn');

		function toggleHelpModal(show) {
			if (show) {
				helpModalOverlay.classList.add('active');
			} else {
				helpModalOverlay.classList.remove('active');
			}
		}

		// 首次访问自动弹出使用说明
		const HELP_SHOWN_KEY = 'fakerrhymes_help_shown';
		if (!localStorage.getItem(HELP_SHOWN_KEY)) {
			toggleHelpModal(true);
			localStorage.setItem(HELP_SHOWN_KEY, '1');
		}

		helpTriggerBtn.addEventListener('click', () => toggleHelpModal(true));
		helpCloseBtn.addEventListener('click', () => toggleHelpModal(false));
		
		// Click outside to close
		helpModalOverlay.addEventListener('click', (e) => {
			if (e.target === helpModalOverlay) {
				toggleHelpModal(false);
			}
		});
		
		// Escape key to close
		document.addEventListener('keydown', (e) => {
			if (e.key === 'Escape' && helpModalOverlay.classList.contains('active')) {
				toggleHelpModal(false);
			}
		});