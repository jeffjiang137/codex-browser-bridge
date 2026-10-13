import * as z from 'zod/v4';
import { validateUploadFiles } from './upload-files.js';
const targetSchema = z.object({
    ref: z.string().optional(),
    frameId: z.number().int().min(0).optional(),
    selector: z.string().optional(),
    text: z.string().optional(),
    role: z.string().optional(),
    label: z.string().optional(),
    placeholder: z.string().optional(),
    nth: z.number().int().min(0).optional(),
    exact: z.boolean().optional()
});
const assertionSchema = z.object({
    kind: z.enum(['visible', 'hidden', 'textContains', 'textEquals', 'valueEquals', 'checked', 'countEquals']),
    target: targetSchema,
    expected: z.union([z.string(), z.boolean(), z.number()]).optional()
});
const actionOptions = [
    z.object({ type: z.literal('click'), target: targetSchema }),
    z.object({ type: z.literal('type'), target: targetSchema, value: z.string(), append: z.boolean().optional() }),
    z.object({
        type: z.literal('press'), key: z.string(), target: targetSchema.optional(),
        ctrl: z.boolean().optional(), alt: z.boolean().optional(), shift: z.boolean().optional(), meta: z.boolean().optional()
    }),
    z.object({
        type: z.literal('scroll'), x: z.number().optional(), y: z.number().optional(), target: targetSchema.optional(),
        behavior: z.enum(['auto', 'smooth']).optional()
    }),
    z.object({ type: z.literal('wait'), ms: z.number().int().min(0).max(10_000) }),
    z.object({ type: z.literal('waitFor'), target: targetSchema, timeoutMs: z.number().int().min(100).max(30_000).optional() })
];
const actionSchema = z.discriminatedUnion('type', actionOptions);
const testStepSchema = z.discriminatedUnion('type', [
    ...actionOptions,
    z.object({ type: z.literal('assert'), assertion: assertionSchema })
]);
const textResult = (value) => ({
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }]
});
const errorResult = (error) => ({
    isError: true,
    content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }]
});
const run = async (fn) => {
    try {
        return textResult(await fn());
    }
    catch (error) {
        return errorResult(error);
    }
};
export function registerBrowserTools(server, bridge) {
    server.registerTool('browser_bridge_status', { description: '检查 Browser Bridge MCP、Microsoft Edge 扩展与窗口授权状态。' }, async () => run(async () => {
        const windowStatus = bridge.connected
            ? await bridge.request('window.status')
            : { browser: 'edge', authorized: false, windowId: null, tabCount: 0, activeTabId: null, authorizedAt: null };
        return {
            ...bridge.status,
            authorizationMode: 'window',
            ...windowStatus,
            authorizedWindowId: windowStatus.windowId ?? null,
            authorizedTabCount: windowStatus.tabCount ?? 0
        };
    }));
    server.registerTool('browser_tabs', { description: '列出已授权 Edge 窗口中的标签页。' }, async () => run(() => bridge.request('tabs.list')));
    server.registerTool('browser_use_tab', {
        description: '选择已授权 Edge 窗口中的标签页。', inputSchema: z.object({ tabId: z.number().int().positive() })
    }, async ({ tabId }) => run(() => bridge.request('tabs.select', { tabId })));
    server.registerTool('browser_window_status', { description: '返回当前 Microsoft Edge 授权窗口的状态。' }, async () => run(() => bridge.request('window.status')));
    server.registerTool('browser_window_tabs', { description: '只列出当前授权 Edge 窗口中的标签页。' }, async () => run(() => bridge.request('window.tabs')));
    server.registerTool('browser_open', {
        description: '在当前授权 Edge 窗口中新建并激活标签页。', inputSchema: z.object({ url: z.string().url().optional() })
    }, async (args) => run(() => bridge.request('window.open', args)));
    server.registerTool('browser_activate_tab', {
        description: '切换到当前授权 Edge 窗口中的标签页。', inputSchema: z.object({ tabId: z.number().int().positive() })
    }, async ({ tabId }) => run(() => bridge.request('window.activateTab', { tabId })));
    server.registerTool('browser_close_tab', {
        description: '关闭当前授权 Edge 窗口中的一个或多个标签页；入口标签页默认受保护。',
        inputSchema: z.object({ tabIds: z.array(z.number().int().positive()).min(1).max(20), force: z.boolean().optional() })
    }, async (args) => run(() => bridge.request('window.closeTab', args)));
    server.registerTool('browser_frames', { description: '列出当前已授权标签页的主 frame 与 iframe，可用于定位跨 frame 元素。' }, async () => run(() => bridge.request('frames.list')));
    server.registerTool('browser_navigate', {
        description: '让当前已授权标签页导航到指定 URL。', inputSchema: z.object({ url: z.string().url() })
    }, async ({ url }) => run(() => bridge.request('page.navigate', { url }, 30_000)));
    server.registerTool('browser_reload', {
        description: '刷新当前已授权标签页。bypassCache=true 会临时使用 CDP。', inputSchema: z.object({ bypassCache: z.boolean().optional() })
    }, async ({ bypassCache }) => run(() => bridge.request('page.reload', { bypassCache }, 30_000)));
    server.registerTool('browser_snapshot', {
        description: '读取紧凑语义快照。Phase 2 会返回所有可访问 iframe，并为元素生成稳定 ref；优先使用 ref 做后续操作。',
        inputSchema: z.object({
            maxInteractive: z.number().int().min(10).max(300).optional(),
            maxTextBlocks: z.number().int().min(10).max(200).optional()
        })
    }, async (args) => run(() => bridge.request('dom.snapshot', args)));
    server.registerTool('browser_find', {
        description: '跨主文档/iframe 按 ref、CSS、文本、role、label 或 placeholder 查找元素。返回稳定 ref。',
        inputSchema: z.object({ target: targetSchema, limit: z.number().int().min(1).max(100).optional() })
    }, async (args) => run(() => bridge.request('dom.find', args)));
    server.registerTool('browser_inspect', {
        description: '读取一个元素当前状态，包括 visible、value、checked、frameId 等。', inputSchema: z.object({ target: targetSchema })
    }, async (args) => run(() => bridge.request('dom.inspect', args)));
    server.registerTool('browser_click', { description: '跨 frame 点击页面元素；推荐传 browser_snapshot/browser_find 返回的 ref。', inputSchema: z.object({ target: targetSchema }) }, async (args) => run(() => bridge.request('dom.click', args)));
    server.registerTool('browser_type', {
        description: '向输入控件输入文本。file input 必须改用 browser_upload。',
        inputSchema: z.object({ target: targetSchema, value: z.string(), append: z.boolean().optional() })
    }, async (args) => run(() => bridge.request('dom.type', args)));
    server.registerTool('browser_press', {
        description: '发送常用键盘事件。',
        inputSchema: z.object({
            key: z.string().min(1), target: targetSchema.optional(), ctrl: z.boolean().optional(), alt: z.boolean().optional(),
            shift: z.boolean().optional(), meta: z.boolean().optional()
        })
    }, async (args) => run(() => bridge.request('dom.press', args)));
    server.registerTool('browser_scroll', {
        description: '滚动主页面或把跨 frame 目标元素滚动到视口。',
        inputSchema: z.object({ x: z.number().optional(), y: z.number().optional(), target: targetSchema.optional(), behavior: z.enum(['auto', 'smooth']).optional() })
    }, async (args) => run(() => bridge.request('dom.scroll', args)));
    server.registerTool('browser_highlight', {
        description: '高亮一个目标元素，便于观察 Codex 即将操作的位置。', inputSchema: z.object({ target: targetSchema, label: z.string().optional() })
    }, async (args) => run(() => bridge.request('dom.highlight', args)));
    server.registerTool('browser_screenshot', { description: '截取当前已授权且可见标签页。' }, async () => {
        try {
            const result = await bridge.request('page.screenshot');
            return screenshotResult(result);
        }
        catch (error) {
            return errorResult(error);
        }
    });
    server.registerTool('browser_action', {
        description: '一次 MCP 调用执行多个跨 frame 动作。后台会逐步重新解析目标，可在不同 iframe 之间连续操作。',
        inputSchema: z.object({ actions: z.array(actionSchema).min(1).max(40) })
    }, async (args) => run(() => bridge.request('dom.batch', args, 60_000)));
    server.registerTool('browser_assert', {
        description: '执行 UI 断言：可见/隐藏/文本/value/checked/数量。适合回归测试。', inputSchema: assertionSchema
    }, async (args) => run(() => bridge.request('dom.assert', args)));
    server.registerTool('browser_test', {
        description: '执行一组动作与断言，返回逐步结果；失败时默认附带精简 snapshot，可选择失败/最终截图。适合 Codex 的“修改→测试→修复→再测”循环。',
        inputSchema: z.object({
            steps: z.array(testStepSchema).min(1).max(60),
            stopOnFailure: z.boolean().optional(),
            snapshotOnFailure: z.boolean().optional(),
            screenshotOnFailure: z.boolean().optional(),
            finalSnapshot: z.boolean().optional(),
            finalScreenshot: z.boolean().optional()
        })
    }, async (args) => {
        try {
            const result = await bridge.request('test.run', args, 120_000);
            const shot = result?.screenshot;
            if (!shot?.dataUrl)
                return textResult(result);
            const clean = { ...result, screenshot: { tabId: shot.tabId, url: shot.url } };
            const image = parseImageDataUrl(shot.dataUrl);
            if (!image)
                return textResult(clean);
            return { content: [{ type: 'text', text: JSON.stringify(clean, null, 2) }, image] };
        }
        catch (error) {
            return errorResult(error);
        }
    });
    server.registerTool('browser_upload', {
        description: '向当前页面的 file input 上传本地文件。路径先在 MCP 端校验，再用短生命周期 CDP 设置文件；默认只允许 MCP 工作目录内文件。',
        inputSchema: z.object({ target: targetSchema, files: z.array(z.string().min(1)).min(1).max(20) })
    }, async ({ target, files }) => run(async () => {
        const validated = await validateUploadFiles(files);
        const result = await bridge.request('page.upload', { target, files: validated.files }, 60_000);
        return { result, validated: { count: validated.files.length, totalBytes: validated.metadata.reduce((sum, item) => sum + item.size, 0) } };
    }));
    server.registerTool('browser_downloads', {
        description: '列出下载记录。默认只显示与当前已授权标签页同源的下载；可选择 session/all。',
        inputSchema: z.object({ scope: z.enum(['currentTab', 'session', 'all']).optional(), limit: z.number().int().min(1).max(100).optional(), query: z.string().optional() })
    }, async (args) => run(() => bridge.request('downloads.list', args)));
    server.registerTool('browser_wait_download', {
        description: '等待匹配下载进入指定状态，默认等待 complete。',
        inputSchema: z.object({
            id: z.number().int().positive().optional(), filenameContains: z.string().optional(), urlContains: z.string().optional(),
            state: z.enum(['in_progress', 'complete', 'interrupted']).optional(), scope: z.enum(['currentTab', 'session', 'all']).optional(),
            timeoutMs: z.number().int().min(100).max(120_000).optional()
        })
    }, async (args) => run(() => bridge.request('downloads.wait', args, 125_000)));
    server.registerTool('browser_download_url', {
        description: '显式启动一个 URL 下载，可指定相对下载目录文件名。',
        inputSchema: z.object({ url: z.string().url(), filename: z.string().optional(), saveAs: z.boolean().optional() })
    }, async (args) => run(() => bridge.request('downloads.start', args)));
    server.registerTool('browser_diagnostics', {
        description: '按需启动/停止当前标签页 CDP Console/Network 诊断。与其他 CDP 控制器可能竞争。', inputSchema: z.object({ action: z.enum(['start', 'stop', 'status', 'clear']) })
    }, async (args) => run(() => bridge.request('diagnostics.control', args)));
    server.registerTool('browser_console', {
        description: '读取 Browser Bridge 采集的 Console/Log。需先开启 diagnostics。', inputSchema: z.object({ limit: z.number().int().min(1).max(500).optional() })
    }, async (args) => run(() => bridge.request('diagnostics.console', args)));
    server.registerTool('browser_network', {
        description: '读取 Browser Bridge 采集的 Network 记录。需先开启 diagnostics。', inputSchema: z.object({ limit: z.number().int().min(1).max(500).optional() })
    }, async (args) => run(() => bridge.request('diagnostics.network', args)));
}
function screenshotResult(result) {
    const image = parseImageDataUrl(result.dataUrl);
    if (!image)
        return errorResult('扩展返回的截图格式无效');
    return { content: [{ type: 'text', text: JSON.stringify({ tabId: result.tabId, url: result.url }) }, image] };
}
function parseImageDataUrl(dataUrl) {
    const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
    if (!match)
        return undefined;
    return { type: 'image', mimeType: match[1], data: match[2] };
}
