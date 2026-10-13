"use strict";
const INSTALL_FLAG = '__codexBrowserBridgeInstalledV2';
const HIGHLIGHT_ID = '__codex-browser-bridge-highlight';
const DOCUMENT_TOKEN = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
const MAX_REFS = 3000;
let frameContext = {
    frameId: window.top === window ? 0 : -1,
    parentFrameId: -1,
    url: location.href
};
let refCounter = 0;
const elementToRef = new WeakMap();
const refToElement = new Map();
if (!window[INSTALL_FLAG]) {
    window[INSTALL_FLAG] = true;
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message?.source !== 'codex-browser-bridge')
            return;
        if (message.command === 'ping') {
            sendResponse({ ok: true, result: contextMetadata() });
            return;
        }
        void (async () => {
            try {
                const result = await routeCommand(message.command, message.payload ?? {});
                sendResponse({ ok: true, result });
            }
            catch (error) {
                sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
            }
        })();
        return true;
    });
}
async function routeCommand(command, payload) {
    switch (command) {
        case 'init':
            frameContext = {
                frameId: Number(payload.frameId),
                parentFrameId: Number(payload.parentFrameId ?? -1),
                url: String(payload.url ?? location.href),
                documentId: payload.documentId ? String(payload.documentId) : undefined
            };
            return contextMetadata();
        case 'snapshot':
            return snapshot(payload);
        case 'find':
            return find(payload.target ?? {}, payload.limit ?? 20).map(describeElement);
        case 'inspect':
            return inspect(payload.target ?? {});
        case 'click':
            return click(payload.target ?? {});
        case 'type':
            return typeText(payload.target ?? {}, payload.value ?? '', Boolean(payload.append));
        case 'press':
            return press(payload.key, payload.target, payload);
        case 'scroll':
            return scroll(payload);
        case 'highlight':
            return highlight(payload.target ?? {}, payload.label);
        case 'fileEvents':
            return dispatchFileEvents(payload.target ?? {});
        case 'batch':
            return batch(payload.actions ?? []);
        default:
            throw new Error(`Unknown content command: ${command}`);
    }
}
function contextMetadata() {
    return {
        ...frameContext,
        actualUrl: location.href,
        documentToken: DOCUMENT_TOKEN,
        topFrame: window.top === window
    };
}
function normalizeText(value) {
    return (value ?? '').replace(/\s+/g, ' ').trim();
}
function isVisible(element) {
    if (!(element instanceof HTMLElement) && !(element instanceof SVGElement))
        return false;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0)
        return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
}
function getRole(element) {
    const explicit = element.getAttribute('role');
    if (explicit)
        return explicit;
    const tag = element.tagName.toLowerCase();
    if (tag === 'button')
        return 'button';
    if (tag === 'a' && element.hasAttribute('href'))
        return 'link';
    if (tag === 'textarea')
        return 'textbox';
    if (tag === 'select')
        return 'combobox';
    if (tag === 'summary')
        return 'button';
    if (tag === 'input') {
        const type = (element.getAttribute('type') || 'text').toLowerCase();
        if (['button', 'submit', 'reset'].includes(type))
            return 'button';
        if (type === 'checkbox')
            return 'checkbox';
        if (type === 'radio')
            return 'radio';
        return 'textbox';
    }
    if (/^h[1-6]$/.test(tag))
        return 'heading';
    return undefined;
}
function getLabel(element) {
    const aria = normalizeText(element.getAttribute('aria-label'));
    if (aria)
        return aria;
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
        const labels = Array.from(element.labels ?? []).map((label) => normalizeText(label.innerText)).filter(Boolean);
        if (labels.length)
            return labels.join(' / ');
    }
    const labelledBy = element.getAttribute('aria-labelledby');
    if (labelledBy) {
        const text = labelledBy
            .split(/\s+/)
            .map((id) => document.getElementById(id))
            .filter(Boolean)
            .map((node) => normalizeText(node.innerText || node?.textContent))
            .filter(Boolean)
            .join(' / ');
        if (text)
            return text;
    }
    return undefined;
}
function accessibleText(element) {
    const aria = normalizeText(element.getAttribute('aria-label'));
    if (aria)
        return aria;
    if (element instanceof HTMLInputElement && ['button', 'submit', 'reset'].includes(element.type)) {
        return normalizeText(element.value);
    }
    return normalizeText(element.innerText || element.textContent);
}
function allRoots() {
    const roots = [document];
    const seen = new Set(roots);
    for (let index = 0; index < roots.length; index += 1) {
        const root = roots[index];
        for (const element of Array.from(root.querySelectorAll('*'))) {
            const shadow = element.shadowRoot;
            if (shadow && !seen.has(shadow)) {
                seen.add(shadow);
                roots.push(shadow);
            }
        }
    }
    return roots;
}
function queryAllDeep(selector, cap = 8000) {
    const result = [];
    for (const root of allRoots()) {
        try {
            result.push(...Array.from(root.querySelectorAll(selector)));
        }
        catch {
            throw new Error(`无效 CSS selector: ${selector}`);
        }
        if (result.length >= cap)
            break;
    }
    return result.slice(0, cap);
}
function getCandidateElements(target) {
    if (target.ref) {
        const element = resolveRef(target.ref);
        return element ? [element] : [];
    }
    if (target.selector)
        return queryAllDeep(target.selector);
    const selector = target.text
        ? '*'
        : 'a,button,input,textarea,select,summary,label,[role],[onclick],[tabindex],[contenteditable="true"],h1,h2,h3,h4,h5,h6';
    return queryAllDeep(selector, target.text ? 7000 : 2500);
}
function matchesTarget(element, target) {
    if (target.ref)
        return element.isConnected;
    if (!isVisible(element))
        return false;
    if (target.role && normalizeText(getRole(element)).toLowerCase() !== normalizeText(target.role).toLowerCase())
        return false;
    if (target.label && !matchString(getLabel(element), target.label, target.exact))
        return false;
    if (target.placeholder && !matchString(element.getAttribute('placeholder'), target.placeholder, target.exact))
        return false;
    if (target.text && !matchString(accessibleText(element), target.text, target.exact))
        return false;
    return true;
}
function matchString(actual, expected, exact = false) {
    const a = normalizeText(actual).toLowerCase();
    const e = normalizeText(expected).toLowerCase();
    return exact ? a === e : a.includes(e);
}
function find(target, limit = 20) {
    const matches = getCandidateElements(target).filter((element) => matchesTarget(element, target));
    if (target.text) {
        const expected = normalizeText(target.text).toLowerCase();
        matches.sort((left, right) => {
            const leftText = accessibleText(left).toLowerCase();
            const rightText = accessibleText(right).toLowerCase();
            const leftExact = leftText === expected ? 0 : 1;
            const rightExact = rightText === expected ? 0 : 1;
            if (leftExact !== rightExact)
                return leftExact - rightExact;
            return leftText.length - rightText.length;
        });
    }
    if (typeof target.nth === 'number') {
        const item = matches[target.nth];
        return item ? [item] : [];
    }
    return matches.slice(0, limit);
}
function requireElement(target, requireVisible = false) {
    let element;
    if (target.ref) {
        element = resolveRef(target.ref);
    }
    else {
        element = find(target, 1)[0];
    }
    if (!element)
        throw new Error(`找不到目标元素: ${JSON.stringify(target)}`);
    if (requireVisible && !isVisible(element))
        throw new Error(`目标元素当前不可见: ${target.ref ?? uniqueSelector(element)}`);
    return element;
}
function refFor(element) {
    const existing = elementToRef.get(element);
    if (existing)
        return existing;
    const ref = `f${frameContext.frameId}:d${DOCUMENT_TOKEN}:e${++refCounter}`;
    elementToRef.set(element, ref);
    refToElement.set(ref, element);
    if (refToElement.size > MAX_REFS) {
        const oldest = refToElement.keys().next().value;
        if (oldest)
            refToElement.delete(oldest);
    }
    return ref;
}
function resolveRef(ref) {
    const match = /^f(-?\d+):d([^:]+):e\d+$/.exec(ref);
    if (!match)
        throw new Error(`无效 Element Ref: ${ref}`);
    if (Number(match[1]) !== frameContext.frameId || match[2] !== DOCUMENT_TOKEN) {
        throw new Error(`REF_STALE: ${ref} 属于旧文档或其他 frame，请重新 browser_snapshot/browser_find。`);
    }
    const element = refToElement.get(ref);
    if (!element || !element.isConnected) {
        refToElement.delete(ref);
        throw new Error(`REF_STALE: ${ref} 对应元素已被页面替换或移除，请重新 browser_snapshot/browser_find。`);
    }
    return element;
}
function escapeCss(value) {
    return CSS.escape(value);
}
function uniqueSelector(element) {
    const root = element.getRootNode();
    const queryRoot = root instanceof ShadowRoot ? root : document;
    if (element.id) {
        const selector = `#${escapeCss(element.id)}`;
        if (queryRoot.querySelectorAll(selector).length === 1)
            return selector;
    }
    for (const attr of ['data-testid', 'data-test', 'data-qa', 'name']) {
        const value = element.getAttribute(attr);
        if (!value)
            continue;
        const selector = `${element.tagName.toLowerCase()}[${attr}="${escapeCss(value)}"]`;
        try {
            if (queryRoot.querySelectorAll(selector).length === 1)
                return selector;
        }
        catch {
            // Continue building a path.
        }
    }
    const parts = [];
    let current = element;
    while (current) {
        const tag = current.tagName.toLowerCase();
        let part = tag;
        const parent = current.parentElement;
        if (parent) {
            const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
            if (siblings.length > 1)
                part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
        }
        parts.unshift(part);
        const selector = parts.join(' > ');
        try {
            if (queryRoot.querySelectorAll(selector).length === 1)
                return selector;
        }
        catch {
            // Continue upward.
        }
        if (!parent)
            break;
        current = parent;
    }
    return parts.join(' > ');
}
function describeElement(element) {
    const rect = element.getBoundingClientRect();
    const tag = element.tagName.toLowerCase();
    const description = {
        ref: refFor(element),
        frameId: frameContext.frameId,
        frameUrl: location.href,
        documentToken: DOCUMENT_TOKEN,
        selector: uniqueSelector(element),
        inShadowRoot: element.getRootNode() instanceof ShadowRoot || undefined,
        tag,
        role: getRole(element),
        text: accessibleText(element).slice(0, 300) || undefined,
        label: getLabel(element),
        placeholder: element.getAttribute('placeholder') || undefined,
        name: element.getAttribute('name') || undefined,
        href: element instanceof HTMLAnchorElement ? element.href : undefined,
        inputType: element instanceof HTMLInputElement ? element.type : undefined,
        disabled: element.disabled || element.getAttribute('aria-disabled') === 'true' || undefined,
        rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
        }
    };
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
        description.value = element.value;
    }
    if (element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type)) {
        description.checked = element.checked;
    }
    return description;
}
function inspect(target) {
    const element = requireElement(target, false);
    return {
        ...describeElement(element),
        visible: isVisible(element),
        connected: element.isConnected
    };
}
function snapshot({ maxInteractive = 120, maxTextBlocks = 80 }) {
    const interactiveSelector = 'a[href],button,input,textarea,select,summary,[role],[onclick],[tabindex],[contenteditable="true"]';
    const interactive = queryAllDeep(interactiveSelector, 4000)
        .filter(isVisible)
        .slice(0, maxInteractive)
        .map(describeElement);
    const headings = queryAllDeep('h1,h2,h3,h4,h5,h6,[role="heading"]', 1000)
        .filter(isVisible)
        .slice(0, 60)
        .map((element) => ({
        ref: refFor(element),
        frameId: frameContext.frameId,
        level: /^H[1-6]$/.test(element.tagName) ? Number(element.tagName[1]) : undefined,
        text: accessibleText(element).slice(0, 500),
        selector: uniqueSelector(element)
    }))
        .filter((item) => item.text);
    const textBlocks = [];
    const seen = new Set();
    for (const element of queryAllDeep('p,li,dt,dd,article,section,main,div,span', 7000)) {
        if (textBlocks.length >= maxTextBlocks)
            break;
        if (!isVisible(element))
            continue;
        const text = accessibleText(element);
        if (text.length < 2 || text.length > 500 || seen.has(text))
            continue;
        const childText = Array.from(element.children).map(accessibleText).join(' ').trim();
        if (childText && normalizeText(childText) === normalizeText(text))
            continue;
        seen.add(text);
        textBlocks.push({ ref: refFor(element), frameId: frameContext.frameId, text, selector: uniqueSelector(element) });
    }
    return {
        title: document.title,
        url: location.href,
        documentToken: DOCUMENT_TOKEN,
        frameId: frameContext.frameId,
        viewport: { width: window.innerWidth, height: window.innerHeight, scrollX: window.scrollX, scrollY: window.scrollY },
        headings,
        interactive,
        textBlocks
    };
}
async function click(target) {
    const element = requireElement(target, true);
    if (element.disabled || element.getAttribute('aria-disabled') === 'true') {
        throw new Error('目标元素当前不可点击（disabled）。');
    }
    element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
    await sleep(30);
    if (element instanceof HTMLElement) {
        element.focus({ preventScroll: true });
        element.click();
    }
    else {
        element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    }
    return { clicked: describeElement(element) };
}
function setNativeValue(element, value) {
    const proto = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    setter?.call(element, value);
}
async function typeText(target, value, append) {
    const element = requireElement(target, true);
    element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        if (element.type === 'file')
            throw new Error('文件输入框请使用 browser_upload，不要使用 browser_type。');
        if (element.disabled || element.readOnly)
            throw new Error('目标输入框不可编辑');
        element.focus({ preventScroll: true });
        const nextValue = append ? element.value + value : value;
        setNativeValue(element, nextValue);
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        return { typed: true, length: nextValue.length, target: describeElement(element) };
    }
    if (element instanceof HTMLElement && element.isContentEditable) {
        element.focus({ preventScroll: true });
        element.textContent = append ? (element.textContent ?? '') + value : value;
        element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
        return { typed: true, length: normalizeText(element.textContent).length, target: describeElement(element) };
    }
    throw new Error('目标元素不是可输入控件');
}
async function press(key, target, modifiers = {}) {
    const element = target ? requireElement(target, true) : (document.activeElement || document.body);
    if (element instanceof HTMLElement)
        element.focus({ preventScroll: true });
    const init = {
        key,
        code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
        bubbles: true,
        cancelable: true,
        ctrlKey: Boolean(modifiers.ctrl),
        altKey: Boolean(modifiers.alt),
        shiftKey: Boolean(modifiers.shift),
        metaKey: Boolean(modifiers.meta)
    };
    element.dispatchEvent(new KeyboardEvent('keydown', init));
    element.dispatchEvent(new KeyboardEvent('keyup', init));
    if (key === 'Enter' && element instanceof HTMLInputElement) {
        const form = element.form;
        if (form && !modifiers.shift)
            form.requestSubmit();
    }
    return { pressed: key, target: element instanceof Element ? describeElement(element) : undefined };
}
async function scroll(payload) {
    if (payload.target) {
        const element = requireElement(payload.target, false);
        element.scrollIntoView({ block: 'center', inline: 'center', behavior: payload.behavior ?? 'auto' });
        return { scrolledTo: describeElement(element), scrollX: window.scrollX, scrollY: window.scrollY };
    }
    window.scrollBy({ left: payload.x ?? 0, top: payload.y ?? 0, behavior: payload.behavior ?? 'auto' });
    return { scrollX: window.scrollX, scrollY: window.scrollY };
}
async function highlight(target, label) {
    const element = requireElement(target, true);
    const previous = document.getElementById(HIGHLIGHT_ID);
    previous?.remove();
    const rect = element.getBoundingClientRect();
    const overlay = document.createElement('div');
    overlay.id = HIGHLIGHT_ID;
    Object.assign(overlay.style, {
        position: 'fixed',
        left: `${Math.max(0, rect.left - 3)}px`,
        top: `${Math.max(0, rect.top - 3)}px`,
        width: `${rect.width + 6}px`,
        height: `${rect.height + 6}px`,
        border: '3px solid #ff3b30',
        borderRadius: '6px',
        boxSizing: 'border-box',
        zIndex: '2147483647',
        pointerEvents: 'none',
        boxShadow: '0 0 0 2px rgba(255,255,255,.9), 0 8px 24px rgba(0,0,0,.22)'
    });
    if (label) {
        const badge = document.createElement('div');
        badge.textContent = label;
        Object.assign(badge.style, {
            position: 'absolute',
            left: '0',
            top: '-30px',
            maxWidth: '360px',
            padding: '4px 8px',
            background: '#ff3b30',
            color: '#fff',
            borderRadius: '4px',
            font: '12px/18px system-ui, sans-serif',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
        });
        overlay.appendChild(badge);
    }
    document.documentElement.appendChild(overlay);
    setTimeout(() => overlay.remove(), 4000);
    return { highlighted: describeElement(element) };
}
function dispatchFileEvents(target) {
    const element = requireElement(target, false);
    if (!(element instanceof HTMLInputElement) || element.type !== 'file') {
        throw new Error('目标元素不是 file input');
    }
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return { files: Array.from(element.files ?? []).map((file) => ({ name: file.name, size: file.size, type: file.type })), target: describeElement(element) };
}
async function waitFor(target, timeoutMs = 10_000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        try {
            const element = find(target, 1)[0];
            if (element)
                return describeElement(element);
        }
        catch (error) {
            if (target.ref)
                throw error;
        }
        await sleep(100);
    }
    throw new Error(`等待元素超时: ${JSON.stringify(target)}`);
}
async function batch(actions) {
    const results = [];
    for (let index = 0; index < actions.length; index += 1) {
        const action = actions[index];
        try {
            switch (action.type) {
                case 'click':
                    results.push(await click(action.target));
                    break;
                case 'type':
                    results.push(await typeText(action.target, action.value, Boolean(action.append)));
                    break;
                case 'press':
                    results.push(await press(action.key, action.target, action));
                    break;
                case 'scroll':
                    results.push(await scroll(action));
                    break;
                case 'wait':
                    await sleep(action.ms);
                    results.push({ waitedMs: action.ms });
                    break;
                case 'waitFor':
                    results.push({ found: await waitFor(action.target, action.timeoutMs ?? 10_000) });
                    break;
            }
        }
        catch (error) {
            throw new Error(`批量动作第 ${index + 1} 步失败 (${action.type}): ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    return { completed: results.length, results };
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
