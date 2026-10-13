import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { clearExpiredPsCache } from '../apps/mcp-server/dist/ps-cache.js';
import { placeBrowserImage } from '../apps/mcp-server/dist/photoshop-import.js';
test('success deletes image and marker; failure retains both until expiry; unmarked files survive', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ps-cache-test-'));
    const previous = process.env.LOCALAPPDATA; process.env.LOCALAPPDATA = root;
    const folder = join(root, 'CodexBrowserBridge', 'photoshop-images');
    const payload = { base64: Buffer.from([137,80,78,71,13,10,26,10]).toString('base64') };
    try {
        await placeBrowserImage(payload, { isRunning: async () => true, place: async () => ({ placed: true }) });
        assert.deepEqual(await readdir(folder), []);
        await placeBrowserImage(payload, { isRunning: async () => true, place: async () => ({ opened: true }) });
        assert.deepEqual(await readdir(folder), []);
        await placeBrowserImage({ ...payload, confirmOpen: true }, { isRunning: async () => false, open: async () => ({ opened: true }) });
        assert.deepEqual(await readdir(folder), []);
        await assert.rejects(placeBrowserImage(payload, { isRunning: async () => true, place: async () => { throw new Error('failed'); } }), /failed/);
        const remaining = await readdir(folder); assert.equal(remaining.length, 2);
        await clearExpiredPsCache(folder); assert.equal((await readdir(folder)).length, 2);
        const marker = remaining.find(name => name.endsWith('.cache.json'));
        const record = JSON.parse(await readFile(join(folder, marker), 'utf8')); record.createdAt -= 86400001;
        await writeFile(join(folder, marker), JSON.stringify(record));
        const userFile = `${randomUUID()}.png`; await writeFile(join(folder, userFile), 'user file');
        await writeFile(join(folder, 'manual.png'), 'user file');
        await clearExpiredPsCache(folder);
        assert.deepEqual((await readdir(folder)).sort(), [userFile, 'manual.png'].sort());
    } finally {
        previous === undefined ? delete process.env.LOCALAPPDATA : process.env.LOCALAPPDATA = previous;
        await rm(root, { recursive: true, force: true });
    }
});
