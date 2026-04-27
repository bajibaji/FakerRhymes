const APP_VERSION = 'v2.0.2';
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
            // Preserve existing spans (like [网页版]) by updating only the text node
            const versionSuffix = ` ${APP_VERSION}`;
            let child = h1Element.firstChild;
            while (child) {
                if (child.nodeType === Node.TEXT_NODE) {
                    const base = child.textContent.replace(/\s+v[\d.]+.*$/, '');
                    child.textContent = base + versionSuffix;
                    break;
                }
                child = child.nextSibling;
            }
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', updateVersion);
    } else {
        updateVersion();
    }
}
