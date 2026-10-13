import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BridgeClient } from '../apps/extension/dist/bridge-client.js';
test('manual reconnect replaces stale socket; stale close cannot drop new connection; failures allow retry', async () => {
    const saved = { WebSocket: globalThis.WebSocket, chrome: globalThis.chrome };
    class Socket extends EventTarget {
        static OPEN = 1; static CONNECTING = 0;
        readyState = 0;
        send() {}
        close() { this.readyState = 3; const event = new Event('close'); this.onclose?.(event); this.dispatchEvent(event); }
        open() { this.readyState = 1; this.onopen?.(); this.dispatchEvent(new Event('open')); }
    }
    globalThis.WebSocket = Socket;
    globalThis.chrome = { runtime: { getManifest: () => ({ version: '0.3.1' }) }, storage: { local: { get: async () => ({}), set: async () => {} } } };
    const client = new BridgeClient(async () => ({}));
    try {
        client.connect(); const old = client.socket;
        const attempt = client.reconnect(); const current = client.socket;
        old.onclose({ code: 1000 }); assert.equal(client.socket, current);
        current.open(); assert.equal((await attempt).connected, true);
        const failure = client.reconnect(); client.socket.close();
        await assert.rejects(failure, /无法连接/);
        const retry = client.reconnect(); client.socket.open(); assert.equal((await retry).connected, true);
    } finally {
        clearInterval(client.keepaliveTimer); clearTimeout(client.reconnectTimer);
        globalThis.WebSocket = saved.WebSocket; globalThis.chrome = saved.chrome;
    }
});
