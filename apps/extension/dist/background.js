import { appendAudit, clearAudit, getAudit } from './audit.js';
import { BridgeClient } from './bridge-client.js';
import { ContentRouter } from './content-router.js';
import { DiagnosticsManager } from './diagnostics.js';
import { DownloadsManager } from './downloads.js';
import { patchState } from './state.js';
import { WindowAuthorizationManager } from './window-authorization.js';
import { UploadManager } from './uploads.js';
import { logPs, readPsLogs } from './ps-debug.js';
import { importNativeImage } from './ps-native.js';
const tabs = new WindowAuthorizationManager();
const content = new ContentRouter(tabs);
const diagnostics = new DiagnosticsManager(tabs);
const downloads = new DownloadsManager(tabs);
const uploads = new UploadManager(tabs, content, diagnostics);
const bridge = new BridgeClient(routeWithAudit);
chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message?.source !== 'codex-ps-image' || !sender.tab?.id || sender.id !== chrome.runtime.id) return;
    void (async () => {
        const requestId = crypto.randomUUID();
        try {
            await logPs('click', `扩展 ${chrome.runtime.getManifest().version}；通信=Native Messaging；确认启动=${message.confirmOpen === true}`, requestId);
            let blob;
            if (message.dataUrl && /^(blob:|data:)/.test(message.url)) {
                if (message.dataUrl.length > 28 * 1024 * 1024 || !/^data:image\//.test(message.dataUrl)) throw new Error('图片数据无效或过大');
                blob = await (await fetch(message.dataUrl)).blob();
            } else {
                const url = new URL(message.url);
                if (!/^https?:$/.test(url.protocol)) throw new Error('不支持此图片地址');
                const response = await fetch(url.href, { credentials: 'include', signal: AbortSignal.timeout(30000) });
                if (!response.ok) throw new Error(`图片下载失败 HTTP ${response.status}`);
                if (Number(response.headers.get('content-length')) > 20 * 1024 * 1024) throw new Error('图片超过 20MB');
                const reader = response.body.getReader(); const chunks = []; let size = 0;
                while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 20 * 1024 * 1024) { await reader.cancel(); throw new Error('图片超过 20MB'); } chunks.push(value); }
                blob = new Blob(chunks);
            }
            if (blob.size > 20 * 1024 * 1024) throw new Error('图片超过 20MB');
            await logPs('image.read', `资源读取成功，${blob.size} 字节`, requestId);
            const bytes = new Uint8Array(await blob.arrayBuffer()); let binary = '';
            for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
            await logPs('native.send', '启动本机 PS 组件，无需 MCP 服务', requestId);
            const result = await importNativeImage(btoa(binary), message.confirmOpen === true, requestId);
            await logPs('result', JSON.stringify(result), requestId);
            reply({ ok: true, result });
        } catch (error) { await logPs('error', error.message, requestId).catch(() => {}); reply({ ok: false, error: `${error.message}（插件弹窗 → PS 调试日志）` }); }
    })();
    return true;
});
async function routeWithAudit(command, payload) {
    const started = performance.now();
    try {
        const result = await routeCommand(command, payload);
        await appendAudit({
            command,
            ok: true,
            durationMs: Math.round(performance.now() - started),
            detail: summarize(command, payload)
        }).catch(() => undefined);
        return result;
    }
    catch (error) {
        await appendAudit({
            command,
            ok: false,
            durationMs: Math.round(performance.now() - started),
            detail: summarize(command, payload)
        }).catch(() => undefined);
        throw error;
    }
}
async function routeCommand(command, payload) {
    switch (command) {
        case 'tabs.list':
            return tabs.listWindowTabs();
        case 'tabs.select':
            return tabs.selectTab(payload.tabId);
        case 'frames.list': {
            const tab = await tabs.requireAuthorizedTab();
            if (!tab.id)
                throw new Error('当前标签页 ID 无效');
            return content.getAllFrameInfo(tab.id);
        }
        case 'page.navigate':
            return navigate(payload.url);
        case 'window.status':
            return tabs.status();
        case 'window.tabs':
            return tabs.listWindowTabs();
        case 'window.open':
            return tabs.open(payload.url);
        case 'window.activateTab':
            return tabs.activateTab(payload.tabId);
        case 'window.closeTab':
            return tabs.closeTabs(payload.tabIds, Boolean(payload.force));
        case 'page.reload':
            return reload(Boolean(payload.bypassCache));
        case 'page.screenshot':
            return screenshot();
        case 'page.upload':
            return uploads.upload(payload.target, payload.files ?? []);
        case 'dom.snapshot':
            return content.snapshot(payload);
        case 'dom.find':
            return content.find(payload.target, payload.limit ?? 20);
        case 'dom.inspect':
            return content.inspect(payload.target);
        case 'dom.click':
            return content.click(payload.target);
        case 'dom.type':
            return content.type(payload.target, payload.value, Boolean(payload.append));
        case 'dom.press':
            return content.press(payload);
        case 'dom.scroll':
            return content.scroll(payload);
        case 'dom.highlight':
            return content.highlight(payload.target, payload.label);
        case 'dom.batch':
            return content.batch(payload.actions ?? []);
        case 'dom.assert':
            return content.assert(payload);
        case 'downloads.list':
            return downloads.list(payload);
        case 'downloads.wait':
            return downloads.wait(payload);
        case 'downloads.start':
            return downloads.start(payload.url, payload.filename, Boolean(payload.saveAs));
        case 'test.run':
            return runTest(payload);
        case 'diagnostics.control':
            return diagnostics.control(payload.action);
        case 'diagnostics.console':
            return diagnostics.getConsole(payload.limit);
        case 'diagnostics.network':
            return diagnostics.getNetwork(payload.limit);
        default:
            throw new Error(`Unknown bridge command: ${command}`);
    }
}
async function navigate(url) {
    const tab = await tabs.requireAuthorizedTab();
    if (!tab.id)
        throw new Error('当前标签页 ID 无效');
    await chrome.tabs.update(tab.id, { url });
    await waitForTabComplete(tab.id, 30_000);
    const current = await chrome.tabs.get(tab.id);
    return { tabId: tab.id, title: current.title, url: current.url };
}
async function reload(bypassCache) {
    const tab = await tabs.requireAuthorizedTab();
    if (!tab.id)
        throw new Error('当前标签页 ID 无效');
    if (bypassCache) {
        await diagnostics.withTemporary(tab.id, async () => {
            await chrome.debugger.sendCommand({ tabId: tab.id }, 'Page.reload', { ignoreCache: true });
        });
    }
    else {
        await chrome.tabs.reload(tab.id);
    }
    await waitForTabComplete(tab.id, 30_000);
    const current = await chrome.tabs.get(tab.id);
    return { tabId: tab.id, title: current.title, url: current.url };
}
function waitForTabComplete(tabId, timeoutMs) {
    return new Promise((resolve) => {
        let finished = false;
        const timeout = setTimeout(done, timeoutMs);
        function done() {
            if (finished)
                return;
            finished = true;
            clearTimeout(timeout);
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
        }
        function listener(updatedTabId, changeInfo) {
            if (updatedTabId === tabId && changeInfo.status === 'complete')
                done();
        }
        chrome.tabs.onUpdated.addListener(listener);
        void chrome.tabs.get(tabId).then((tab) => {
            if (tab.status === 'complete')
                done();
        }).catch(done);
    });
}
async function screenshot() {
    const tab = await tabs.requireAuthorizedTab();
    if (!tab.id)
        throw new Error('当前标签页 ID 无效');
    if (!tab.active)
        await chrome.tabs.update(tab.id, { active: true });
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    return { tabId: tab.id, url: tab.url, dataUrl };
}
async function runTest(payload) {
    const steps = Array.isArray(payload.steps) ? payload.steps : [];
    const results = [];
    let failedStep;
    let error;
    for (let index = 0; index < steps.length; index += 1) {
        const step = steps[index];
        try {
            let result;
            switch (step.type) {
                case 'click':
                    result = await content.click(step.target);
                    break;
                case 'type':
                    result = await content.type(step.target, step.value, Boolean(step.append));
                    break;
                case 'press':
                    result = await content.press(step);
                    break;
                case 'scroll':
                    result = await content.scroll(step);
                    break;
                case 'wait':
                    await sleep(step.ms);
                    result = { waitedMs: step.ms };
                    break;
                case 'waitFor':
                    result = await content.waitFor(step.target, step.timeoutMs ?? 10_000);
                    break;
                case 'assert':
                    result = await content.assert(step.assertion);
                    break;
                default:
                    throw new Error(`未知测试步骤: ${step.type}`);
            }
            results.push({ step: index + 1, type: step.type, ok: true, result });
        }
        catch (caught) {
            failedStep = index + 1;
            error = caught instanceof Error ? caught.message : String(caught);
            results.push({ step: index + 1, type: step.type, ok: false, error });
            if (payload.stopOnFailure !== false)
                break;
        }
    }
    const passed = failedStep === undefined;
    const snap = (!passed && payload.snapshotOnFailure !== false) || payload.finalSnapshot
        ? await content.snapshot({ maxInteractive: 80, maxTextBlocks: 40 }).catch(() => undefined)
        : undefined;
    const shot = (!passed && payload.screenshotOnFailure) || payload.finalScreenshot
        ? await screenshot().catch(() => undefined)
        : undefined;
    return {
        passed,
        totalSteps: steps.length,
        completedSteps: results.filter((item) => item.ok).length,
        failedStep,
        error,
        results,
        snapshot: snap,
        screenshot: shot
    };
}
chrome.tabs.onRemoved.addListener((tabId) => {
    diagnostics.cleanup(tabId);
});
chrome.windows.onRemoved.addListener((windowId) => {
    void (async () => {
        if (await tabs.handleWindowRemoved(windowId)) {
            await diagnostics.cleanupAll();
        }
    })();
});
chrome.runtime.onMessage.addListener((message, _sender, sendResponseToPopup) => {
    if (message?.source !== 'codex-browser-bridge-popup')
        return;
    void (async () => {
        try {
            if (message.command === 'psDebug') {
                sendResponseToPopup({ ok: true, result: { connected: bridge.connected, logs: await readPsLogs() } });
                return;
            }
            if (message.command === 'connectMcp') {
                sendResponseToPopup({ ok: true, result: await bridge.reconnect() });
                return;
            }
            if (message.command === 'clearPsDebug') {
                await logPs('clear', '清除调试日志');
                await chrome.storage.local.set({ psDebug: [] });
                sendResponseToPopup({ ok: true }); return;
            }
            if (message.command === 'state') {
                const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
                const active = activeTabs[0];
                const windowState = await tabs.status();
                sendResponseToPopup({
                    ok: true,
                    result: {
                        connected: bridge.connected,
                        activeTab: active?.id ? {
                            id: active.id,
                            title: active.title,
                            url: active.url,
                            authorized: await tabs.isTabAuthorized(active.id),
                            selected: false,
                            diagnostics: diagnostics.isActive(active.id)
                        } : null,
                        window: windowState,
                        audit: await getAudit(8)
                    }
                });
                return;
            }
            if (message.command === 'toggleAuthorization') {
                const existing = await tabs.getAuthorizedWindow();
                const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (existing?.windowId === active?.windowId) {
                    await diagnostics.cleanupAll();
                    await tabs.revokeWindow();
                }
                else {
                    const authorized = await tabs.authorizeCurrentWindow();
                    const root = await tabs.requireAuthorizedTab(authorized.rootTabId);
                    const frames = await content.ensureFrames(root.id);
                    if (!frames.some((frame) => frame.frameId === 0 && frame.reachable)) {
                        await tabs.revokeWindow();
                        throw new Error('当前页面无法注入 Browser Bridge。');
                    }
                }
                sendResponseToPopup({ ok: true, result: await tabs.status() });
                return;
            }
            if (message.command === 'toggleDiagnostics') {
                const active = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
                if (!active?.id)
                    throw new Error('无法获取当前标签页');
                if (!(await tabs.isTabAuthorized(active.id)))
                    throw new Error('当前标签页不属于已授权窗口');
                await patchState({ selectedTabId: active.id });
                const result = await diagnostics.control(diagnostics.isActive(active.id) ? 'stop' : 'start');
                sendResponseToPopup({ ok: true, result });
                return;
            }
            if (message.command === 'clearAudit') {
                await clearAudit();
                sendResponseToPopup({ ok: true });
                return;
            }
            throw new Error(`Unknown popup command: ${message.command}`);
        }
        catch (error) {
            sendResponseToPopup({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
    })();
    return true;
});
function summarize(command, payload) {
    if (command === 'page.navigate') {
        try {
            return new URL(payload.url).hostname;
        }
        catch {
            return 'navigate';
        }
    }
    if (command === 'page.upload')
        return `上传 ${Array.isArray(payload.files) ? payload.files.length : 0} 个文件`;
    if (command === 'dom.type')
        return `输入 ${String(payload.value ?? '').length} 字符`;
    const target = payload?.target;
    if (target?.ref)
        return target.ref;
    if (target?.text)
        return `text=${String(target.text).slice(0, 40)}`;
    if (target?.label)
        return `label=${String(target.label).slice(0, 40)}`;
    if (target?.selector)
        return `selector=${String(target.selector).slice(0, 60)}`;
    return undefined;
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
bridge.connect();
