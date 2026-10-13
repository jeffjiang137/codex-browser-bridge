export class DownloadsManager {
    tabs;
    sessionStartedAt = new Date().toISOString();
    constructor(tabs) {
        this.tabs = tabs;
    }
    async list(args = {}) {
        await this.tabs.requireAuthorizedTab();
        const scope = args.scope ?? 'currentTab';
        const limit = Math.max(1, Math.min(args.limit ?? 20, 100));
        const raw = await chrome.downloads.search({
            query: args.query ? [args.query] : undefined,
            orderBy: ['-startTime'],
            limit: Math.min(limit * 4, 400)
        });
        const filtered = await this.applyScope(raw, scope);
        return {
            scope,
            sessionStartedAt: this.sessionStartedAt,
            count: Math.min(filtered.length, limit),
            items: filtered.slice(0, limit).map(describeDownload)
        };
    }
    async wait(args) {
        await this.tabs.requireAuthorizedTab();
        const timeoutMs = Math.max(100, Math.min(args.timeoutMs ?? 60_000, 120_000));
        const expectedState = args.state ?? 'complete';
        const started = Date.now();
        while (Date.now() - started < timeoutMs) {
            let items;
            if (typeof args.id === 'number') {
                items = await chrome.downloads.search({ id: args.id });
            }
            else {
                const result = await this.list({ scope: args.scope ?? 'currentTab', limit: 100 });
                const ids = result.items.map((item) => item.id);
                items = [];
                for (const id of ids) {
                    const found = await chrome.downloads.search({ id });
                    items.push(...found);
                }
            }
            const match = items.find((item) => {
                if (args.filenameContains && !item.filename.toLowerCase().includes(args.filenameContains.toLowerCase()))
                    return false;
                const url = `${item.url ?? ''} ${item.finalUrl ?? ''}`.toLowerCase();
                if (args.urlContains && !url.includes(args.urlContains.toLowerCase()))
                    return false;
                return item.state === expectedState;
            });
            if (match) {
                return { matched: true, item: describeDownload(match), waitedMs: Date.now() - started };
            }
            await sleep(250);
        }
        throw new Error(`等待下载超时（${timeoutMs}ms），未发现 state=${expectedState} 的匹配下载。`);
    }
    async start(url, filename, saveAs = false) {
        await this.tabs.requireAuthorizedTab();
        if (filename && (filename.startsWith('/') || filename.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(filename) || filename.split(/[\\/]+/).includes('..'))) {
            throw new Error('下载 filename 必须是 Chrome 下载目录内的相对路径，不能包含绝对路径或 ..。');
        }
        const id = await chrome.downloads.download({ url, filename, saveAs });
        return { id, started: true, url, filename };
    }
    async applyScope(items, scope) {
        if (scope === 'all')
            return items;
        if (scope === 'session') {
            const start = Date.parse(this.sessionStartedAt);
            return items.filter((item) => Date.parse(item.startTime) >= start);
        }
        const tab = await this.tabs.requireAuthorizedTab();
        const origin = safeOrigin(tab.url);
        if (!origin)
            return [];
        return items.filter((item) => {
            const candidates = [item.referrer, item.url, item.finalUrl].filter(Boolean);
            return candidates.some((value) => safeOrigin(value) === origin);
        });
    }
}
function describeDownload(item) {
    return {
        id: item.id,
        url: item.url,
        finalUrl: item.finalUrl,
        referrer: item.referrer,
        filename: item.filename,
        state: item.state,
        danger: item.danger,
        mime: item.mime,
        startTime: item.startTime,
        endTime: item.endTime,
        bytesReceived: item.bytesReceived,
        totalBytes: item.totalBytes,
        exists: item.exists,
        error: item.error
    };
}
function safeOrigin(value) {
    if (!value)
        return undefined;
    try {
        return new URL(value).origin;
    }
    catch {
        return undefined;
    }
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
