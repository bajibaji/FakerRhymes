const APP_VERSION = 'v1.8.8';
console.log('Debug: version.js loaded, APP_VERSION =', APP_VERSION);

// Auto-update DOM if running in browser
if (typeof document !== 'undefined') {
    const updateVersion = () => {
        const titleElement = document.querySelector('title');
        if (titleElement) {
            titleElement.textContent = `废壳韵脚生成器 ${APP_VERSION} `;
        }
        
        const h1Element = document.querySelector('h1');
        if (h1Element) {
            // Preserve existing spans (like [网页版])
            const spans = Array.from(h1Element.querySelectorAll('span')).map(s => s.outerHTML).join('');
            h1Element.innerHTML = `废壳韵脚生成器 ${APP_VERSION}${spans}`;
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', updateVersion);
    } else {
        updateVersion();
    }
}
