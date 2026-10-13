import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
test('native host exchanges length-prefixed chunks and rejects invalid image without COM', async () => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../native/ps-host.mjs', import.meta.url))], { stdio: ['pipe', 'pipe', 'pipe'] });
    let input = Buffer.alloc(0); const waiting = [];
    child.stdout.on('data', value => {
        input = Buffer.concat([input, value]);
        while (input.length >= 4 && input.length >= input.readUInt32LE(0) + 4) {
            const size = input.readUInt32LE(0); const msg = JSON.parse(input.subarray(4, size + 4)); input = input.subarray(size + 4);
            waiting.shift()?.(msg);
        }
    });
    function exchange(msg) {
        return new Promise(resolve => {
            waiting.push(resolve); const body = Buffer.from(JSON.stringify(msg)); const header = Buffer.alloc(4); header.writeUInt32LE(body.length);
            child.stdin.write(header); child.stdin.write(body);
        });
    }
    try {
        assert.equal((await exchange({ type: 'start' })).type, 'ready');
        assert.equal((await exchange({ type: 'chunk', value: Buffer.from('<html>not an image</html>').toString('base64') })).type, 'ack');
        const messages = [];
        const final = new Promise(resolve => {
            function next(msg) { messages.push(msg); if (msg.type === 'result') resolve(msg); else waiting.push(next); }
            waiting.push(next);
        });
        const body = Buffer.from(JSON.stringify({ type: 'execute' })); const header = Buffer.alloc(4); header.writeUInt32LE(body.length); child.stdin.write(Buffer.concat([header, body]));
        const result = await final; assert.equal(result.ok, false); assert.match(result.error, /仅支持/);
        assert.ok(messages.some(msg => msg.type === 'progress'));
    } finally { child.kill(); }
});
