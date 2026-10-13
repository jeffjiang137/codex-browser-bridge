export class ContentRouter {
    tabs;
    constructor(tabs) {
        this.tabs = tabs;
    }
    async ensureFrames(tabId) {
        const rawFrames = await chrome.webNavigation.getAllFrames({ tabId });
        const frames = (rawFrames ?? [{ frameId: 0, parentFrameId: -1, url: (await chrome.tabs.get(tabId)).url ?? '' }])
            .map((frame) => ({
            frameId: frame.frameId,
            parentFrameId: frame.parentFrameId,
            url: frame.url ?? '',
            documentId: frame.documentId
        }))
            .sort((a, b) => a.frameId - b.frameId);
        const results = [];
        for (const frame of frames) {
            try {
                await chrome.scripting.executeScript({
                    target: { tabId, frameIds: [frame.frameId] },
                    files: ['content.js']
                });
                const response = await this.sendToFrame(tabId, frame.frameId, 'init', frame);
                if (!response?.ok)
                    throw new Error(response?.error || '初始化 content script 失败');
                results.push({ ...frame, reachable: true });
            }
            catch (error) {
                results.push({
                    ...frame,
                    reachable: false,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }
        return results;
    }
    async snapshot(payload = {}) {
        const tab = await this.requireTab();
        const frames = await this.ensureFrames(tab.id);
        const snapshots = [];
        for (const frame of frames) {
            if (!frame.reachable) {
                snapshots.push({ ...frame, error: frame.error });
                continue;
            }
            try {
                const response = await this.sendToFrame(tab.id, frame.frameId, 'snapshot', payload);
                if (!response?.ok)
                    throw new Error(response?.error || 'snapshot 失败');
                snapshots.push({ ...frame, ...response.result });
            }
            catch (error) {
                snapshots.push({ ...frame, error: error instanceof Error ? error.message : String(error) });
            }
        }
        const main = snapshots.find((item) => item.frameId === 0 && !item.error);
        if (!main)
            throw new Error('无法读取主文档快照。');
        return {
            title: main.title,
            url: main.url,
            viewport: main.viewport,
            headings: main.headings,
            interactive: main.interactive,
            textBlocks: main.textBlocks,
            documentToken: main.documentToken,
            frames: snapshots,
            frameSummary: {
                total: frames.length,
                reachable: frames.filter((frame) => frame.reachable).length,
                inaccessible: frames.filter((frame) => !frame.reachable).length
            }
        };
    }
    async find(target, limit = 20) {
        const tab = await this.requireTab();
        const frames = await this.ensureFrames(tab.id);
        const requestedNth = target.nth;
        const targetWithoutNth = { ...target, nth: undefined };
        const scopedFrames = this.framesForTarget(frames, target);
        const collected = [];
        for (const frame of scopedFrames) {
            if (!frame.reachable)
                continue;
            const response = await this.sendToFrame(tab.id, frame.frameId, 'find', {
                target: { ...targetWithoutNth, frameId: undefined },
                limit: Math.max(limit, (requestedNth ?? 0) + 1)
            });
            if (!response?.ok) {
                if (target.ref)
                    throw new Error(response?.error || `ref ${target.ref} 已失效`);
                continue;
            }
            collected.push(...(response.result ?? []));
        }
        if (typeof requestedNth === 'number') {
            const item = collected[requestedNth];
            return item ? [item] : [];
        }
        return collected.slice(0, limit);
    }
    async inspect(target) {
        const resolved = await this.resolveTarget(target);
        const tab = await this.requireTab();
        const response = await this.sendToFrame(tab.id, resolved.frameId, 'inspect', { target: resolved.target });
        if (!response?.ok)
            throw new Error(response?.error || '读取元素状态失败');
        return response.result;
    }
    async click(target) {
        return this.targetCommand('click', target, { target });
    }
    async type(target, value, append = false) {
        return this.targetCommand('type', target, { target, value, append });
    }
    async press(payload) {
        if (!payload.target)
            return this.mainFrameCommand('press', payload);
        return this.targetCommand('press', payload.target, payload);
    }
    async scroll(payload) {
        if (!payload.target)
            return this.mainFrameCommand('scroll', payload);
        return this.targetCommand('scroll', payload.target, payload);
    }
    async highlight(target, label) {
        return this.targetCommand('highlight', target, { target, label });
    }
    async fileEvents(target) {
        return this.targetCommand('fileEvents', target, { target });
    }
    async batch(actions) {
        const results = [];
        for (let index = 0; index < actions.length; index += 1) {
            const action = actions[index];
            try {
                switch (action.type) {
                    case 'click':
                        results.push(await this.click(action.target));
                        break;
                    case 'type':
                        results.push(await this.type(action.target, action.value, Boolean(action.append)));
                        break;
                    case 'press':
                        results.push(await this.press(action));
                        break;
                    case 'scroll':
                        results.push(await this.scroll(action));
                        break;
                    case 'wait':
                        await sleep(action.ms);
                        results.push({ waitedMs: action.ms });
                        break;
                    case 'waitFor':
                        results.push({ found: await this.waitFor(action.target, action.timeoutMs ?? 10_000) });
                        break;
                }
            }
            catch (error) {
                throw new Error(`批量动作第 ${index + 1} 步失败 (${action.type}): ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        return { completed: results.length, results };
    }
    async waitFor(target, timeoutMs = 10_000) {
        const started = Date.now();
        while (Date.now() - started < timeoutMs) {
            const matches = await this.find(target, 1);
            if (matches[0])
                return matches[0];
            await sleep(100);
        }
        throw new Error(`等待元素超时: ${JSON.stringify(target)}`);
    }
    async assert(assertion) {
        const { kind, target, expected } = assertion;
        const matches = await this.find(target, kind === 'countEquals' ? 200 : 1);
        if (kind === 'visible') {
            return assertionResult(matches.length > 0, kind, true, matches.length > 0);
        }
        if (kind === 'hidden') {
            return assertionResult(matches.length === 0, kind, true, matches.length === 0);
        }
        if (kind === 'countEquals') {
            const expectedCount = Number(expected ?? 0);
            return assertionResult(matches.length === expectedCount, kind, expectedCount, matches.length);
        }
        if (!matches[0])
            throw new Error(`断言目标不存在: ${JSON.stringify(target)}`);
        const inspected = await this.inspect({ ref: matches[0].ref, frameId: matches[0].frameId });
        if (kind === 'textContains') {
            const actual = String(inspected.text ?? '');
            return assertionResult(actual.includes(String(expected ?? '')), kind, expected, actual);
        }
        if (kind === 'textEquals') {
            const actual = String(inspected.text ?? '').trim();
            return assertionResult(actual === String(expected ?? '').trim(), kind, expected, actual);
        }
        if (kind === 'valueEquals') {
            const actual = inspected.value ?? '';
            return assertionResult(String(actual) === String(expected ?? ''), kind, expected, actual);
        }
        const actual = Boolean(inspected.checked);
        return assertionResult(actual === Boolean(expected), kind, Boolean(expected), actual);
    }
    async resolveTarget(target) {
        const matches = await this.find(target, Math.max(1, (target.nth ?? 0) + 1));
        const element = matches[0];
        if (!element)
            throw new Error(`找不到目标元素: ${JSON.stringify(target)}`);
        return {
            frameId: Number(element.frameId),
            target: { ref: String(element.ref), frameId: Number(element.frameId) },
            element
        };
    }
    async getFrameInfo(tabId, frameId) {
        const frames = await this.ensureFrames(tabId);
        return frames.find((frame) => frame.frameId === frameId);
    }
    async getAllFrameInfo(tabId) {
        return this.ensureFrames(tabId);
    }
    async targetCommand(command, target, payload) {
        const resolved = await this.resolveTarget(target);
        const tab = await this.requireTab();
        const response = await this.sendToFrame(tab.id, resolved.frameId, command, {
            ...payload,
            target: resolved.target
        });
        if (!response?.ok)
            throw new Error(response?.error || `页面操作失败: ${command}`);
        return { ...response.result, frameId: resolved.frameId };
    }
    async mainFrameCommand(command, payload) {
        const tab = await this.requireTab();
        const frames = await this.ensureFrames(tab.id);
        const main = frames.find((frame) => frame.frameId === 0 && frame.reachable);
        if (!main)
            throw new Error('主 frame 不可访问');
        const response = await this.sendToFrame(tab.id, 0, command, payload);
        if (!response?.ok)
            throw new Error(response?.error || `页面操作失败: ${command}`);
        return response.result;
    }
    framesForTarget(frames, target) {
        if (typeof target.frameId === 'number') {
            return frames.filter((frame) => frame.frameId === target.frameId);
        }
        if (target.ref) {
            const frameId = parseRefFrameId(target.ref);
            return frames.filter((frame) => frame.frameId === frameId);
        }
        return frames;
    }
    async requireTab() {
        const tab = await this.tabs.requireAuthorizedTab();
        if (!tab.id)
            throw new Error('当前标签页 ID 无效');
        return { ...tab, id: tab.id };
    }
    sendToFrame(tabId, frameId, command, payload) {
        return chrome.tabs.sendMessage(tabId, { source: 'codex-browser-bridge', command, payload }, { frameId });
    }
}
function parseRefFrameId(ref) {
    const match = /^f(-?\d+):d[^:]+:e\d+$/.exec(ref);
    if (!match)
        throw new Error(`无效 Element Ref: ${ref}`);
    return Number(match[1]);
}
function assertionResult(passed, kind, expected, actual) {
    if (!passed) {
        throw new Error(`断言失败 (${kind})：expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
    }
    return { passed, kind, expected, actual };
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
