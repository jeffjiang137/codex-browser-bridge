import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { BrowserBridge } from '../apps/mcp-server/dist/bridge.js';
test('multiple extension clients coexist and closing one retains another', () => {
    const bridge = Object.create(BrowserBridge.prototype);
    Object.assign(bridge, { clients: new Set(), pending: new Map(), socket: null });
    function connect() {
        const socket = new EventEmitter(); socket.readyState = 1; socket.messages = [];
        socket.close = () => { socket.closed = true; };
        socket.send = value => socket.messages.push(JSON.parse(value));
        bridge.onConnection(socket, { headers: { origin: 'chrome-extension://fixture' } });
        bridge.onMessage(socket, JSON.stringify({ type: 'hello', client: 'codex-browser-bridge-extension', version: '0.2.8' }));
        return socket;
    }
    const first = connect(); const second = connect();
    assert.equal(first.closed, undefined); assert.equal(bridge.clients.size, 2);
    assert.equal(first.messages[0].version, '0.2.8');
    second.emit('close'); assert.equal(bridge.socket, first); assert.equal(bridge.connected, true);
    first.emit('close'); assert.equal(bridge.connected, false);
});
