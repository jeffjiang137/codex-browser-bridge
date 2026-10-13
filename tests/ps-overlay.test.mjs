import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
test('covered image buttons hide in preview and restore after closing; click errors show feedback', async () => {
    const source = await readFile(new URL('../apps/extension/dist/ps-images.js', import.meta.url), 'utf8');
    const elements = []; let frame; let covered = false; let modal = null;
    function element(tag) {
        const el = { tag, style: {}, listeners: {}, children: [], isConnected: true,
            append(child) { child.parentNode = this; this.children.push(child); },
            remove() { this.parentNode.children = this.parentNode.children.filter(child => child !== this); },
            contains(other) { return this === other || this.children.includes(other); },
            addEventListener(name, fn) { this.listeners[name] = fn; }, setAttribute() {},
            querySelector() { return this.children.find(child => child.className === 'notice'); },
            getClientRects() { return [1]; }, attachShadow() { return this.shadow = element('shadow'); }
        }; elements.push(el); return el;
    }
    const page = element('page');
    const img = element('img'); img.src = 'https://example.com/a.png'; img.getAttribute = () => null; img.closest = () => null;
    img.getBoundingClientRect = () => ({ width: 200, height: 200, left: 0, top: 0, right: 200, bottom: 200 });
    const doc = { documentElement: page, images: [img], createElement: element, addEventListener() {},
        querySelectorAll: () => modal ? [modal] : [], elementFromPoint: () => covered ? modal : img };
    vm.runInNewContext(source, { document: doc, innerWidth: 800, innerHeight: 600,
        getComputedStyle: () => ({ visibility: 'visible' }), MutationObserver: class { observe() {} },
        requestAnimationFrame: fn => { frame = fn; }, addEventListener() {}, setInterval() {}, setTimeout() {}, clearTimeout() {},
        chrome: { runtime: { sendMessage: async () => ({ ok: false, error: '本地未连接' }) } }, URL, Promise });
    frame(); const button = elements.find(el => el.tag === 'button'); assert.equal(button.hidden, false);
    modal = element('dialog'); covered = true; frame(); assert.equal(button.hidden, true);
    modal = null; covered = false; frame(); assert.equal(button.hidden, false);
    button.listeners.click({ preventDefault() {}, stopPropagation() {} });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(button.disabled, false);
    assert.equal(elements.filter(el => el.className === 'notice').at(-1).textContent, '本地未连接');
});
