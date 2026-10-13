import { getState, patchState, setState } from './state.js';
const SUPPORTED_PAGE = /^https?:|^file:/;
export class WindowAuthorizationManager {
    async authorizeCurrentWindow() {
        const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!active?.id || active.windowId === chrome.windows.WINDOW_ID_NONE || !SUPPORTED_PAGE.test(active.url ?? '')) {
            throw new Error('该页面类型不支持 Browser Bridge。');
        }
        const authorizedWindow = {
            windowId: active.windowId,
            authorizedAt: Date.now(),
            rootTabId: active.id,
            browser: 'edge'
        };
        await setState({ authorizedWindow, selectedTabId: active.id });
        return authorizedWindow;
    }
    async revokeWindow() {
        await setState({});
    }
    async getAuthorizedWindow() {
        const state = await getState();
        const authorized = state.authorizedWindow;
        if (!authorized)
            return undefined;
        try {
            await chrome.windows.get(authorized.windowId);
            if (authorized.rootTabId) {
                const root = await chrome.tabs.get(authorized.rootTabId);
                if (root.windowId !== authorized.windowId)
                    throw new Error('root tab no longer belongs to the authorized window');
            }
            return authorized;
        }
        catch {
            await this.revokeWindow();
            return undefined;
        }
    }
    async isWindowAuthorized(windowId) {
        return (await this.getAuthorizedWindow())?.windowId === windowId;
    }
    async isTabAuthorized(tabId) {
        try {
            const tab = await chrome.tabs.get(tabId);
            return this.isWindowAuthorized(tab.windowId);
        }
        catch {
            return false;
        }
    }
    async requireAuthorizedTab(tabId) {
        const state = await getState();
        const authorized = await this.getAuthorizedWindow();
        if (!authorized)
            throw new Error('NO_AUTHORIZED_WINDOW: 请在 Microsoft Edge 中点击“授权当前窗口”。');
        const requestedId = tabId ?? state.selectedTabId;
        let tab;
        if (requestedId) {
            try {
                tab = await chrome.tabs.get(requestedId);
            }
            catch { /* fall through */ }
        }
        if (!tab) {
            const [active] = await chrome.tabs.query({ active: true, windowId: authorized.windowId });
            tab = active;
        }
        if (!tab?.id)
            throw new Error('NO_AUTHORIZED_WINDOW: 授权窗口中没有可操作的标签页。');
        if (tab.windowId !== authorized.windowId)
            throw new Error('WINDOW_NOT_AUTHORIZED: 标签页不属于当前授权的 Edge 窗口。');
        if (!SUPPORTED_PAGE.test(tab.url ?? ''))
            throw new Error('该页面类型不支持 Browser Bridge。');
        if (state.selectedTabId !== tab.id)
            await patchState({ selectedTabId: tab.id });
        return tab;
    }
    async selectTab(tabId) {
        const tab = await this.requireAuthorizedTab(tabId);
        await patchState({ selectedTabId: tab.id });
        return { tabId: tab.id, title: tab.title, url: tab.url, windowId: tab.windowId };
    }
    async listWindowTabs() {
        const authorized = await this.getAuthorizedWindow();
        if (!authorized)
            throw new Error('NO_AUTHORIZED_WINDOW: 请先授权一个 Edge 窗口。');
        const state = await getState();
        const tabs = await chrome.tabs.query({ windowId: authorized.windowId });
        return tabs.filter((tab) => typeof tab.id === 'number').map((tab) => ({
            tabId: tab.id, id: tab.id, windowId: tab.windowId, title: tab.title, url: tab.url,
            active: Boolean(tab.active), selected: state.selectedTabId === tab.id
        }));
    }
    async status() {
        const authorized = await this.getAuthorizedWindow();
        if (!authorized)
            return { authorized: false, browser: 'edge', windowId: null, tabCount: 0, activeTabId: null, authorizedAt: null };
        const tabs = await chrome.tabs.query({ windowId: authorized.windowId });
        return {
            authorized: true, browser: authorized.browser, windowId: authorized.windowId,
            tabCount: tabs.length, activeTabId: tabs.find((tab) => tab.active)?.id ?? null,
            authorizedAt: authorized.authorizedAt, rootTabId: authorized.rootTabId ?? null
        };
    }
    async open(url) {
        const authorized = await this.getAuthorizedWindow();
        if (!authorized)
            throw new Error('NO_AUTHORIZED_WINDOW: 请先授权一个 Edge 窗口。');
        const tab = await chrome.tabs.create({ windowId: authorized.windowId, url: url || undefined, active: true });
        if (!tab.id)
            throw new Error('无法在授权窗口中创建标签页。');
        await patchState({ selectedTabId: tab.id });
        return { tabId: tab.id, windowId: tab.windowId, title: tab.title, url: tab.url, active: tab.active };
    }
    async activateTab(tabId) {
        const tab = await this.requireAuthorizedTab(tabId);
        const updated = await chrome.tabs.update(tab.id, { active: true });
        if (!updated?.id)
            throw new Error('无法激活授权窗口中的标签页。');
        await patchState({ selectedTabId: tab.id });
        return { tabId: updated.id, windowId: updated.windowId, title: updated.title, url: updated.url, active: updated.active };
    }
    async closeTabs(tabIds, force = false) {
        const authorized = await this.getAuthorizedWindow();
        if (!authorized)
            throw new Error('NO_AUTHORIZED_WINDOW: 请先授权一个 Edge 窗口。');
        if (!tabIds.length)
            throw new Error('至少需要提供一个 tabId。');
        for (const tabId of tabIds) {
            const tab = await this.requireAuthorizedTab(tabId);
            if (!force && tab.id === authorized.rootTabId)
                throw new Error('不能关闭任务入口标签页；如确实需要，请设置 force=true。');
        }
        await chrome.tabs.remove(tabIds);
        const state = await getState();
        if (state.selectedTabId && tabIds.includes(state.selectedTabId))
            await patchState({ selectedTabId: undefined });
        return { closedTabIds: tabIds };
    }
    async cleanupInvalidAuthorization(windowId) {
        const authorized = await this.getAuthorizedWindow();
        if (authorized && (!windowId || authorized.windowId === windowId))
            await this.revokeWindow();
    }
    async handleWindowRemoved(windowId) {
        const state = await getState();
        if (state.authorizedWindow?.windowId !== windowId)
            return false;
        await this.revokeWindow();
        return true;
    }
}
