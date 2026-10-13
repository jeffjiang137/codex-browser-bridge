(() => {
    if (globalThis.__codexPsImages) return;
    globalThis.__codexPsImages = true;
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>button{position:absolute;pointer-events:auto;border:0;border-radius:4px;width:28px;height:24px;padding:0;background:#1677ff;color:white;font:bold 13px Arial;opacity:.2;cursor:pointer;transition:opacity .15s}button:hover,button:focus-visible,button:disabled{opacity:1}button:disabled{cursor:wait}.notice{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);padding:12px 18px;background:#172b4d;color:white;border-radius:6px;font:14px Arial;max-width:80vw}</style>`;
    document.documentElement.append(host);
    const entries = new Map();
    let scheduled = false;
    let noticeTimer;
    function notify(text) {
        root.querySelector('.notice')?.remove();
        const notice = document.createElement('div'); notice.className = 'notice'; notice.textContent = text; root.append(notice);
        clearTimeout(noticeTimer); noticeTimer = setTimeout(() => notice.remove(), 7000);
    }
    function resource(img) {
        for (const attr of ['data-original', 'data-origin', 'data-full', 'data-zoom-image', 'data-large']) {
            const value = img.getAttribute(attr);
            if (value) { const url = new URL(value, document.baseURI); if (/^https?:$/.test(url.protocol)) return url.href; }
        }
        const link = img.closest('a[href]');
        if (link && /\.(png|jpe?g|gif|webp)(?:[?#]|$)/i.test(link.href)) return link.href;
        return img.currentSrc || img.src;
    }
    async function send(img, button) {
        button.disabled = true; button.textContent = '…';
        notify('正在读取图片并连接 Photoshop…');
        try {
            const url = resource(img);
            let dataUrl;
            if (/^(blob:|data:)/.test(url)) {
                const blob = await (await fetch(url)).blob();
                if (blob.size > 20 * 1024 * 1024) throw new Error('图片超过 20MB');
                dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
            }
            const request = (confirmOpen = false) => Promise.race([
                chrome.runtime.sendMessage({ source: 'codex-ps-image', url, dataUrl, confirmOpen }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('图片处理超时，请检查 PS 图层和本地服务连接后重试')), 135000))
            ]);
            let result = await request();
            if (result?.ok && result.result?.requiresConfirmation) {
                if (!confirm(result.result.message)) return;
                notify('正在启动 Photoshop 并打开图片…');
                result = await request(true);
            }
            if (!result?.ok) throw new Error(result?.error || '插件连接失效，请刷新网页');
            notify(result.result?.message || '已置入 Photoshop');
        } catch (error) { notify(error.message || '置入失败'); }
        finally { button.disabled = false; button.textContent = 'ps'; }
    }
    function update() {
        scheduled = false;
        // Native modal dialogs and popovers render above even maximum z-index.
        const modal = [...document.querySelectorAll('dialog[open], [role="dialog"][aria-modal="true"]')].reverse().find(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
        const container = modal || document.documentElement;
        if (host.parentNode !== container) container.append(host);
        // Exclude our own overlay from hit tests so covered page images stay hidden.
        host.style.visibility = 'hidden';
        for (const [img, button] of entries) if (!img.isConnected) { button.remove(); entries.delete(img); }
        for (const img of document.images) {
            const rect = img.getBoundingClientRect();
            let button = entries.get(img);
            const x = Math.min(innerWidth - 30, Math.max(2, rect.right - 32));
            const y = Math.max(2, rect.top + 4);
            const hit = document.elementFromPoint(x + 14, y + 12);
            const visible = rect.width >= 40 && rect.height >= 40 && rect.bottom > y + 24 && rect.right > x + 28 && rect.top < innerHeight && rect.left < innerWidth && getComputedStyle(img).visibility !== 'hidden' && (!modal || modal.contains(img)) && (hit === img || img.contains(hit));
            if (!visible) { if (button) button.hidden = true; continue; }
            if (!button) {
                button = document.createElement('button'); button.textContent = 'ps'; button.title = '将图片资源置入 Photoshop'; button.setAttribute('aria-label', '将图片置入 Photoshop');
                button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); void send(img, button); });
                root.append(button); entries.set(img, button);
            }
            button.hidden = false;
            button.style.left = `${x}px`;
            button.style.top = `${y}px`;
        }
        host.style.visibility = 'visible';
    }
    function schedule() { if (!scheduled) { scheduled = true; requestAnimationFrame(update); } }
    new MutationObserver(records => { if (records.some(record => record.target !== host && !host.contains(record.target))) schedule(); }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'srcset', 'style', 'class', 'hidden', 'open', 'aria-modal'] });
    addEventListener('scroll', schedule, true); addEventListener('resize', schedule); document.addEventListener('load', schedule, true);
    setInterval(schedule, 1500); schedule();
})();
