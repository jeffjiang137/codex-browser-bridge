const DEFAULT_BRIDGE_URL = 'ws://127.0.0.1:17373';
import { logPs } from './ps-debug.js';
export class BridgeClient {
    handler;
    url;
    socket = null;
    reconnectTimer;
    keepaliveTimer;
    reconnectDelay = 500;
    imageRequests = new Map();
    psComSupported = false;
    importImage(payload) {
        if (!this.connected) return Promise.reject(new Error('本地 Browser Bridge 未连接，请重启 Codex 并检查插件连接状态'));
        if (!this.psComSupported) return Promise.reject(new Error('连接的本地服务尚未确认支持 COM 图片置入，可能仍是旧版本。请完全退出并重新打开 Codex，让 Browser Bridge 服务重新启动，再刷新网页'));
        if (this.imageRequests.size) return Promise.reject(new Error('上一张图片正在置入，请稍候'));
        const id = crypto.randomUUID();
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { this.imageRequests.delete(id); reject(new Error('置入超时，请先检查 Photoshop 图层，避免重复置入')); }, 100000);
            this.imageRequests.set(id, { resolve, reject, timer });
            void logPs('ws.send', '发送 COM 图片请求', id);
            this.socket.send(JSON.stringify({ type: 'photoshop_import', id, payload }));
        });
    }
    constructor(handler, url = DEFAULT_BRIDGE_URL) {
        this.handler = handler;
        this.url = url;
    }
    get connected() {
        return this.socket?.readyState === WebSocket.OPEN;
    }
    reconnect(timeoutMs = 8000) {
        clearTimeout(this.reconnectTimer);
        clearInterval(this.keepaliveTimer);
        const previous = this.socket;
        this.socket = null;
        this.psComSupported = false;
        this.reconnectDelay = 500;
        for (const pending of this.imageRequests.values()) { clearTimeout(pending.timer); pending.reject(new Error('手动重连中，请检查 PS 图层后重试')); }
        this.imageRequests.clear();
        previous?.close();
        this.connect();
        const socket = this.socket;
        return new Promise((resolve, reject) => {
            const cleanup = () => { clearTimeout(timer); socket.removeEventListener('open', opened); socket.removeEventListener('close', failed); };
            const opened = () => { cleanup(); resolve({ connected: true, url: this.url }); };
            const failed = () => { cleanup(); reject(new Error('无法连接本地 MCP 服务（127.0.0.1:17373），请确认 Browser Bridge 服务已启动，再点击连接')); };
            const timer = setTimeout(() => { cleanup(); if (this.socket === socket) socket.close(); reject(new Error('连接超时，请确认本地 Browser Bridge 服务已启动')); }, timeoutMs);
            socket.addEventListener('open', opened);
            socket.addEventListener('close', failed);
        });
    }
    connect() {
        if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING))
            return;
        clearTimeout(this.reconnectTimer);
        this.socket = new WebSocket(this.url);
        const socket = this.socket;
        this.socket.onopen = () => {
            if (this.socket !== socket) return;
            this.psComSupported = false;
            this.reconnectDelay = 500;
            console.log('[Codex Browser Bridge] Connected to MCP bridge');
            this.socket?.send(JSON.stringify({
                type: 'hello',
                client: 'codex-browser-bridge-extension',
                version: chrome.runtime.getManifest().version
            }));
            clearInterval(this.keepaliveTimer);
            this.keepaliveTimer = setInterval(() => {
                if (this.socket?.readyState === WebSocket.OPEN) {
                    this.socket.send(JSON.stringify({ type: 'keepalive' }));
                }
            }, 20_000);
        };
        this.socket.onmessage = (event) => {
            if (this.socket !== socket) return;
            let message;
            try {
                message = JSON.parse(String(event.data));
            }
            catch {
                return;
            }
            if (message.type === 'request')
                void this.handleRequest(message);
            if (message.type === 'hello_ack') {
                this.psComSupported = message.capabilities?.includes('photoshop_import_com_v1') === true;
                void logPs('server.version', `服务版本=${message.version}；COM支持=${this.psComSupported}`);
            }
            if (message.type === 'photoshop_progress') void logPs('ps.progress', message.detail, message.id);
            if (message.type === 'photoshop_result') {
                const pending = this.imageRequests.get(message.id);
                if (pending) { clearTimeout(pending.timer); this.imageRequests.delete(message.id); message.ok ? pending.resolve(message.result) : pending.reject(new Error(message.error)); }
            }
        };
        this.socket.onclose = (event) => {
            if (this.socket !== socket) return;
            void logPs('ws.closed', `断开代码=${event.code}；原因=${event.reason || '无'}；将自动重连`);
            this.psComSupported = false;
            for (const pending of this.imageRequests.values()) { clearTimeout(pending.timer); pending.reject(new Error('本地连接断开，请检查 PS 图层后再重试')); }
            this.imageRequests.clear();
            this.socket = null;
            clearInterval(this.keepaliveTimer);
            this.keepaliveTimer = undefined;
            this.scheduleReconnect();
        };
        this.socket.onerror = () => socket.close();
    }
    scheduleReconnect() {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => this.connect(), this.reconnectDelay);
        this.reconnectDelay = Math.min(this.reconnectDelay * 1.6, 5_000);
    }
    async handleRequest(request) {
        try {
            const result = await this.handler(request.command, request.payload ?? {});
            this.send({ type: 'response', id: request.id, ok: true, result });
        }
        catch (error) {
            this.send({
                type: 'response',
                id: request.id,
                ok: false,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }
    send(response) {
        if (this.socket?.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify(response));
        }
    }
}
