import { randomUUID } from 'node:crypto';
import { placeBrowserImage } from './photoshop-import.js';
import { WebSocket, WebSocketServer } from 'ws';
export class BrowserBridge {
    host;
    port;
    wss;
    socket = null;
    pending = new Map();
    extensionVersion = null;
    clients = new Set();
    constructor(host = '127.0.0.1', port = 17373) {
        this.host = host;
        this.port = port;
        this.wss = new WebSocketServer({ host, port });
        this.wss.on('connection', (socket, request) => this.onConnection(socket, request));
        this.wss.on('listening', () => {
            console.error(`[browser-bridge] WebSocket listening on ws://${host}:${port}`);
        });
        this.wss.on('error', (error) => {
            console.error('[browser-bridge] WebSocket server error:', error);
        });
    }
    get connected() {
        return this.socket?.readyState === WebSocket.OPEN;
    }
    get status() {
        return {
            connected: this.connected,
            host: this.host,
            port: this.port,
            extensionVersion: this.extensionVersion
        };
    }
    async request(command, payload, timeoutMs = 15_000) {
        const socket = this.socket;
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            throw new Error('Chrome 扩展尚未连接 Browser Bridge。请先加载扩展并确认扩展状态为“已连接”。');
        }
        const id = randomUUID();
        const message = { type: 'request', id, command, payload };
        return await new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`Browser Bridge 请求超时: ${command}`));
            }, timeoutMs);
            this.pending.set(id, {
                resolve: (value) => resolve(value),
                reject,
                timer
            });
            socket.send(JSON.stringify(message), (error) => {
                if (!error)
                    return;
                clearTimeout(timer);
                this.pending.delete(id);
                reject(error);
            });
        });
    }
    async close() {
        for (const [id, pending] of this.pending) {
            clearTimeout(pending.timer);
            pending.reject(new Error('Browser Bridge 已关闭'));
            this.pending.delete(id);
        }
        for (const client of this.clients) client.close();
        await new Promise((resolve) => this.wss.close(() => resolve()));
    }
    onConnection(socket, request) {
        const origin = request.headers.origin;
        const isExtensionOrigin = origin?.startsWith('chrome-extension://') || origin?.startsWith('edge-extension://');
        if (origin && !isExtensionOrigin) {
            console.error(`[browser-bridge] Rejected non-extension WebSocket origin: ${origin}`);
            socket.close(1008, 'Only Chromium extension clients are allowed');
            return;
        }
        this.clients.add(socket);
        this.socket = socket;
        this.extensionVersion = null;
        console.error('[browser-bridge] Browser extension connected');
        socket.on('message', (raw) => this.onMessage(socket, raw.toString()));
        socket.on('close', () => {
            this.clients.delete(socket);
            if (this.socket === socket) {
                this.socket = [...this.clients].find(client => client.readyState === WebSocket.OPEN && client.extensionVersion) || null;
                this.extensionVersion = this.socket?.extensionVersion || null;
            for (const [id, pending] of this.pending) {
                clearTimeout(pending.timer);
                pending.reject(new Error('Chrome 扩展连接已断开'));
                this.pending.delete(id);
            }
            }
            console.error('[browser-bridge] Browser extension disconnected');
        });
    }
    onMessage(socket, raw) {
        let message;
        try {
            message = JSON.parse(raw);
        }
        catch {
            return;
        }
        if (message.type === 'keepalive') {
            socket.send(JSON.stringify({ type: 'keepalive_ack' }));
            return;
        }
        if (message.type === 'hello') {
            if (message.client !== 'codex-browser-bridge-extension') {
                socket.close(1008, 'Unknown bridge client');
                return;
            }
            this.extensionVersion = message.version;
            socket.extensionVersion = message.version;
            socket.send(JSON.stringify({ type: 'hello_ack', capabilities: ['photoshop_import_com_v1'], version: '0.2.8' }));
            return;
        }
        if (message.type === 'photoshop_import' && socket.extensionVersion && this.clients.has(socket)) {
            const progress = detail => {
                if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'photoshop_progress', id: message.id, detail }));
            };
            progress('本地服务收到图片请求，等待执行');
            this.imageQueue = (this.imageQueue || Promise.resolve()).then(async () => {
                try {
                    const result = await placeBrowserImage(message.payload || {}, { progress });
                    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'photoshop_result', id: message.id, ok: true, result }));
                } catch (error) {
                    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'photoshop_result', id: message.id, ok: false, error: error.message }));
                }
            });
            return;
        }
        if (message.type !== 'response')
            return;
        const response = message;
        const pending = this.pending.get(response.id);
        if (!pending)
            return;
        clearTimeout(pending.timer);
        this.pending.delete(response.id);
        if (response.ok) {
            pending.resolve(response.result);
        }
        else {
            pending.reject(new Error(response.error || 'Browser Bridge command failed'));
        }
    }
}
