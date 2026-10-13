const MAX_DIAGNOSTIC_ENTRIES = 500;
// Chromium-family browsers, including Edge, expose the stable CDP 1.3 API.
// The legacy "0.1" version is rejected by current Edge builds.
const DEBUGGER_PROTOCOL_VERSION = '1.3';
export class DiagnosticsManager {
    tabs;
    diagnosticTabs = new Set();
    consoleLogs = new Map();
    networkLogs = new Map();
    constructor(tabs) {
        this.tabs = tabs;
        chrome.debugger.onEvent.addListener((source, method, params) => this.onEvent(source, method, params));
        chrome.debugger.onDetach.addListener((source) => {
            if (source.tabId)
                this.diagnosticTabs.delete(source.tabId);
        });
    }
    isActive(tabId) {
        return this.diagnosticTabs.has(tabId);
    }
    cleanup(tabId) {
        this.diagnosticTabs.delete(tabId);
        this.consoleLogs.delete(tabId);
        this.networkLogs.delete(tabId);
    }
    async cleanupAll() {
        const tabIds = [...this.diagnosticTabs];
        await Promise.all(tabIds.map((tabId) => chrome.debugger.detach({ tabId }).catch(() => undefined)));
        this.diagnosticTabs.clear();
        this.consoleLogs.clear();
        this.networkLogs.clear();
    }
    async withTemporary(tabId, fn) {
        const alreadyAttached = this.diagnosticTabs.has(tabId);
        if (!alreadyAttached) {
            try {
                await chrome.debugger.attach({ tabId }, DEBUGGER_PROTOCOL_VERSION);
            }
            catch (error) {
                throw new Error(`无法临时连接 Chrome 调试目标。可能已有 Chrome DevTools / Chrome DevTools MCP 占用。${error instanceof Error ? ` ${error.message}` : ''}`);
            }
        }
        try {
            return await fn();
        }
        finally {
            if (!alreadyAttached) {
                await chrome.debugger.detach({ tabId }).catch(() => undefined);
            }
        }
    }
    async control(action) {
        const tab = await this.tabs.requireAuthorizedTab();
        if (!tab.id)
            throw new Error('当前标签页 ID 无效');
        const tabId = tab.id;
        if (action === 'status') {
            return {
                tabId,
                active: this.diagnosticTabs.has(tabId),
                consoleEntries: this.consoleLogs.get(tabId)?.length ?? 0,
                networkEntries: this.networkLogs.get(tabId)?.length ?? 0
            };
        }
        if (action === 'clear') {
            this.consoleLogs.set(tabId, []);
            this.networkLogs.set(tabId, []);
            return { tabId, cleared: true, active: this.diagnosticTabs.has(tabId) };
        }
        if (action === 'start') {
            if (!this.diagnosticTabs.has(tabId)) {
                try {
                    await chrome.debugger.attach({ tabId }, DEBUGGER_PROTOCOL_VERSION);
                    this.diagnosticTabs.add(tabId);
                    this.consoleLogs.set(tabId, []);
                    this.networkLogs.set(tabId, []);
                    await Promise.all([
                        chrome.debugger.sendCommand({ tabId }, 'Runtime.enable'),
                        chrome.debugger.sendCommand({ tabId }, 'Log.enable'),
                        chrome.debugger.sendCommand({ tabId }, 'Network.enable')
                    ]);
                }
                catch (error) {
                    this.diagnosticTabs.delete(tabId);
                    throw new Error(`无法开启诊断会话。可能已有 Chrome DevTools / Chrome DevTools MCP 占用调试目标。${error instanceof Error ? ` ${error.message}` : ''}`);
                }
            }
            return { tabId, active: true };
        }
        if (this.diagnosticTabs.has(tabId)) {
            await chrome.debugger.detach({ tabId }).catch(() => undefined);
            this.diagnosticTabs.delete(tabId);
        }
        return { tabId, active: false };
    }
    async getConsole(limit = 100) {
        const tab = await this.tabs.requireAuthorizedTab();
        if (!tab.id)
            throw new Error('当前标签页 ID 无效');
        return {
            tabId: tab.id,
            active: this.diagnosticTabs.has(tab.id),
            entries: (this.consoleLogs.get(tab.id) ?? []).slice(-limit)
        };
    }
    async getNetwork(limit = 100) {
        const tab = await this.tabs.requireAuthorizedTab();
        if (!tab.id)
            throw new Error('当前标签页 ID 无效');
        return {
            tabId: tab.id,
            active: this.diagnosticTabs.has(tab.id),
            entries: (this.networkLogs.get(tab.id) ?? []).slice(-limit)
        };
    }
    pushLimited(map, tabId, entry) {
        const list = map.get(tabId) ?? [];
        list.push(entry);
        if (list.length > MAX_DIAGNOSTIC_ENTRIES)
            list.splice(0, list.length - MAX_DIAGNOSTIC_ENTRIES);
        map.set(tabId, list);
    }
    onEvent(source, method, params) {
        const tabId = source.tabId;
        if (!tabId || !this.diagnosticTabs.has(tabId))
            return;
        const at = new Date().toISOString();
        if (method === 'Runtime.consoleAPICalled') {
            const text = (params.args ?? []).map((arg) => arg.value ?? arg.description ?? arg.type).join(' ');
            this.pushLimited(this.consoleLogs, tabId, {
                at,
                source: 'console',
                level: params.type ?? 'log',
                text
            });
        }
        else if (method === 'Log.entryAdded') {
            this.pushLimited(this.consoleLogs, tabId, {
                at,
                source: params.entry?.source ?? 'log',
                level: params.entry?.level ?? 'info',
                text: params.entry?.text ?? ''
            });
        }
        else if (method === 'Network.requestWillBeSent') {
            this.pushLimited(this.networkLogs, tabId, {
                at,
                phase: 'request',
                requestId: params.requestId,
                method: params.request?.method,
                url: params.request?.url,
                resourceType: params.type
            });
        }
        else if (method === 'Network.responseReceived') {
            this.pushLimited(this.networkLogs, tabId, {
                at,
                phase: 'response',
                requestId: params.requestId,
                url: params.response?.url,
                status: params.response?.status,
                mimeType: params.response?.mimeType,
                resourceType: params.type
            });
        }
        else if (method === 'Network.loadingFailed') {
            this.pushLimited(this.networkLogs, tabId, {
                at,
                phase: 'failed',
                requestId: params.requestId,
                errorText: params.errorText,
                resourceType: params.type
            });
        }
    }
}
