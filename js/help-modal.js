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