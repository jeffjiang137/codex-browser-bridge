export class UploadManager {
    tabs;
    content;
    diagnostics;
    constructor(tabs, content, diagnostics) {
        this.tabs = tabs;
        this.content = content;
        this.diagnostics = diagnostics;
    }
    async upload(target, files) {
        const tab = await this.tabs.requireAuthorizedTab();
        if (!tab.id)
            throw new Error('当前标签页 ID 无效');
        const resolved = await this.content.resolveTarget(target);
        const element = resolved.element;
        if (element.tag !== 'input' || element.inputType !== 'file') {
            throw new Error('browser_upload 的目标必须是 <input type="file">。');
        }
        if (element.inShadowRoot) {
            throw new Error('当前阶段的 CDP 上传暂不支持 Shadow DOM 内的 file input；请改用 Chrome DevTools MCP 完成该上传。');
        }
        const frame = await this.content.getFrameInfo(tab.id, resolved.frameId);
        if (!frame)
            throw new Error(`无法找到上传目标所在 frame: ${resolved.frameId}`);
        const result = await this.diagnostics.withTemporary(tab.id, async () => {
            await Promise.all([
                chrome.debugger.sendCommand({ tabId: tab.id }, 'DOM.enable'),
                chrome.debugger.sendCommand({ tabId: tab.id }, 'Page.enable')
            ]);
            const frameTreeResponse = await chrome.debugger.sendCommand({ tabId: tab.id }, 'Page.getFrameTree');
            const cdpFrames = flattenFrameTree(frameTreeResponse.frameTree);
            const chromeFrames = await this.content.getAllFrameInfo(tab.id);
            const cdpFrameId = mapChromeFrameToCdp(frame, chromeFrames, cdpFrames);
            const docResponse = await chrome.debugger.sendCommand({ tabId: tab.id }, 'DOM.getDocument', { depth: -1, pierce: true });
            const root = docResponse.root;
            const documentNodeId = resolved.frameId === 0
                ? root?.nodeId
                : findContentDocumentNodeId(root, cdpFrameId);
            if (!documentNodeId) {
                throw new Error('CDP 无法解析上传目标 frame 的 Document 节点。');
            }
            const query = await chrome.debugger.sendCommand({ tabId: tab.id }, 'DOM.querySelector', { nodeId: documentNodeId, selector: element.selector });
            if (!query?.nodeId) {
                throw new Error(`CDP 无法按 selector 找到 file input: ${element.selector}`);
            }
            await chrome.debugger.sendCommand({ tabId: tab.id }, 'DOM.setFileInputFiles', { nodeId: query.nodeId, files });
            return { cdpFrameId, nodeId: query.nodeId };
        });
        const events = await this.content.fileEvents({ ref: element.ref, frameId: resolved.frameId });
        return {
            uploaded: files.length,
            frameId: resolved.frameId,
            target: element,
            cdp: result,
            inputState: events
        };
    }
}
function flattenFrameTree(tree, parentId) {
    if (!tree?.frame)
        return [];
    const current = {
        id: String(tree.frame.id),
        parentId: tree.frame.parentId ? String(tree.frame.parentId) : parentId,
        url: normalizeUrl(String(tree.frame.url ?? ''))
    };
    return [current, ...(tree.childFrames ?? []).flatMap((child) => flattenFrameTree(child, current.id))];
}
function mapChromeFrameToCdp(target, chromeFrames, cdpFrames) {
    const main = cdpFrames.find((frame) => !frame.parentId);
    if (!main)
        throw new Error('CDP FrameTree 中没有主 frame。');
    if (target.frameId === 0)
        return main.id;
    const byChromeId = new Map(chromeFrames.map((frame) => [frame.frameId, frame]));
    const cache = new Map([[0, main.id]]);
    const resolve = (frameId) => {
        const cached = cache.get(frameId);
        if (cached)
            return cached;
        const chromeFrame = byChromeId.get(frameId);
        if (!chromeFrame)
            throw new Error(`找不到 Chrome frame ${frameId}`);
        let candidates = cdpFrames.filter((frame) => normalizeUrl(frame.url) === normalizeUrl(chromeFrame.url));
        if (chromeFrame.parentFrameId >= 0) {
            const parentCdpId = resolve(chromeFrame.parentFrameId);
            candidates = candidates.filter((frame) => frame.parentId === parentCdpId);
        }
        if (candidates.length !== 1) {
            throw new Error(`无法唯一映射 iframe 到 CDP frame（frameId=${frameId}, url=${chromeFrame.url}, candidates=${candidates.length}）。请改用 Chrome DevTools MCP 上传。`);
        }
        cache.set(frameId, candidates[0].id);
        return candidates[0].id;
    };
    return resolve(target.frameId);
}
function findContentDocumentNodeId(node, cdpFrameId) {
    if (!node)
        return undefined;
    if (String(node.frameId ?? '') === cdpFrameId && node.contentDocument?.nodeId) {
        return Number(node.contentDocument.nodeId);
    }
    const nested = [
        ...(node.children ?? []),
        ...(node.shadowRoots ?? []),
        node.contentDocument,
        node.templateContent
    ].filter(Boolean);
    for (const child of nested) {
        const found = findContentDocumentNodeId(child, cdpFrameId);
        if (found)
            return found;
    }
    return undefined;
}
function normalizeUrl(value) {
    try {
        const url = new URL(value);
        url.hash = '';
        return url.href;
    }
    catch {
        return value.split('#')[0] ?? value;
    }
}
