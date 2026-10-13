"use strict";
async function showPsLogs() {
    const response = await chrome.runtime.sendMessage({ source: 'codex-browser-bridge-popup', command: 'psDebug' });
    if (!response?.ok) throw new Error(response?.error || '无法读取日志');
    const text = `PS 通信：Native Messaging（无需 MCP）\nMCP 浏览器工具连接：${response.result.connected ? '已连接' : '未连接'}（不影响 PS 按钮）\n` + response.result.logs.map(row => `${row.time} [${row.stage}] ${row.requestId} ${row.detail}`).join('\n');
    document.querySelector('#psLogs').textContent = text; return text;
}
document.querySelector('#psLogsRefresh').addEventListener('click', () => showPsLogs().catch(error => { document.querySelector('#psLogs').textContent = error.message; }));
document.querySelector('#psLogsExport').addEventListener('click', async () => {
    try {
        const text = await showPsLogs(); const href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
        const link = document.createElement('a'); link.href = href; link.download = 'ps-debug-log.txt'; link.click(); setTimeout(() => URL.revokeObjectURL(href), 10000);
    } catch (error) { document.querySelector('#psLogs').textContent = error.message; }
});
document.querySelector('#psLogsClear').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ source: 'codex-browser-bridge-popup', command: 'clearPsDebug' }); await showPsLogs();
});
const connection = document.querySelector('#connection');
const connectMcp = document.querySelector('#connectMcp');
connectMcp.addEventListener('click', async () => {
    connectMcp.disabled = true;
    const result = document.querySelector('#mcpConnectResult'); result.textContent = '正在连接本地 MCP 服务…';
    try {
        const response = await send('connectMcp');
        if (!response?.ok) throw new Error(response?.error || '连接失败');
        await loadState(); result.textContent = 'MCP 已连接';
    } catch (error) { result.textContent = error.message; await loadState().catch(() => {}); }
    finally { connectMcp.disabled = false; }
});
const title = document.querySelector('#title');
const url = document.querySelector('#url');
const authorize = document.querySelector('#authorize');
const diagnostics = document.querySelector('#diagnostics');
const authorizedCount = document.querySelector('#authorizedCount');
const refresh = document.querySelector('#refresh');
const clearAudit = document.querySelector('#clearAudit');
const auditList = document.querySelector('#auditList');
const errorBox = document.querySelector('#error');
function send(command) {
    return chrome.runtime.sendMessage({ source: 'codex-browser-bridge-popup', command });
}
async function loadState() {
    hideError();
    const response = await send('state');
    if (!response?.ok)
        throw new Error(response?.error || '无法读取扩展状态');
    render(response.result);
}
function render(state) {
    connectMcp.textContent = state.connected ? '重新连接 MCP' : '连接 MCP';
    connection.textContent = state.connected ? 'MCP 已连接' : 'MCP 未连接';
    connection.className = `status ${state.connected ? 'online' : 'offline'}`;
    authorizedCount.textContent = state.window.authorized ? `当前窗口已授权 · ${state.window.tabCount} 个标签页` : '未授权窗口';
    renderAudit(state.audit ?? []);
    if (!state.activeTab) {
        title.textContent = '无法读取当前页面';
        url.textContent = '—';
        authorize.disabled = true;
        diagnostics.disabled = true;
        return;
    }
    title.textContent = state.activeTab.title || '未命名页面';
    url.textContent = state.activeTab.url || '—';
    authorize.disabled = false;
    authorize.textContent = state.window.authorized ? '取消当前窗口授权' : '授权当前窗口';
    authorize.className = `primary ${state.window.authorized ? 'authorized' : ''}`;
    diagnostics.disabled = !state.window.authorized || !state.activeTab.authorized;
    diagnostics.textContent = state.activeTab.diagnostics ? '停止 Console / Network 诊断' : '开启 Console / Network 诊断';
    diagnostics.className = `secondary ${state.activeTab.diagnostics ? 'active' : ''}`;
}
function renderAudit(entries) {
    auditList.replaceChildren();
    if (!entries.length) {
        const empty = document.createElement('div');
        empty.className = 'audit-empty';
        empty.textContent = '暂无 MCP 操作记录';
        auditList.appendChild(empty);
        return;
    }
    for (const entry of entries) {
        const row = document.createElement('div');
        row.className = `audit-row ${entry.ok ? 'ok' : 'failed'}`;
        const marker = document.createElement('span');
        marker.className = 'audit-marker';
        marker.textContent = entry.ok ? '✓' : '×';
        const body = document.createElement('div');
        body.className = 'audit-body';
        const command = document.createElement('div');
        command.className = 'audit-command';
        command.textContent = entry.command;
        const detail = document.createElement('div');
        detail.className = 'audit-detail';
        const time = new Date(entry.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        detail.textContent = `${time} · ${entry.durationMs}ms${entry.detail ? ` · ${entry.detail}` : ''}`;
        body.append(command, detail);
        row.append(marker, body);
        auditList.appendChild(row);
    }
}
function showError(error) {
    errorBox.hidden = false;
    errorBox.textContent = error instanceof Error ? error.message : String(error);
}
function hideError() {
    errorBox.hidden = true;
    errorBox.textContent = '';
}
authorize.addEventListener('click', async () => {
    authorize.disabled = true;
    try {
        const response = await send('toggleAuthorization');
        if (!response?.ok)
            throw new Error(response?.error || '授权操作失败');
        await loadState();
    }
    catch (error) {
        showError(error);
        authorize.disabled = false;
    }
});
diagnostics.addEventListener('click', async () => {
    diagnostics.disabled = true;
    try {
        const response = await send('toggleDiagnostics');
        if (!response?.ok)
            throw new Error(response?.error || '诊断操作失败');
        await loadState();
    }
    catch (error) {
        showError(error);
        diagnostics.disabled = false;
    }
});
clearAudit.addEventListener('click', async () => {
    try {
        const response = await send('clearAudit');
        if (!response?.ok)
            throw new Error(response?.error || '清除记录失败');
        await loadState();
    }
    catch (error) {
        showError(error);
    }
});
refresh.addEventListener('click', () => void loadState().catch(showError));
void loadState().catch(showError);
