import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { placeBrowserImage, placeViaCom } from '../apps/mcp-server/dist/photoshop-import.js';
test('rejects empty and unsupported resources before PS', async () => {
    await assert.rejects(placeBrowserImage({}), /为空/);
    await assert.rejects(placeBrowserImage({ base64: Buffer.from('<html>login</html>').toString('base64') }), /仅支持/);
});
test('COM dispatch preserves original bytes without HTTP bridge', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'ps-com-test-'));
    const previous = process.env.LOCALAPPDATA; process.env.LOCALAPPDATA = folder;
    const bytes = Buffer.from([137,80,78,71,13,10,26,10]);
    try {
        const deps = { isRunning: async () => true, place: async path => {
            assert.deepEqual(await readFile(path), bytes); return { placed: true };
        }};
        assert.deepEqual(await placeBrowserImage({base64: bytes.toString('base64')}, deps), {placed:true});
        deps.place = async () => { throw new Error('COM failed'); };
        await assert.rejects(placeBrowserImage({base64: bytes.toString('base64')}, deps), /COM failed/);
    } finally {
        previous === undefined ? delete process.env.LOCALAPPDATA : process.env.LOCALAPPDATA = previous;
        await rm(folder, {recursive:true,force:true});
    }
});
test('COM command passes image path as separate argument and reports failures', async () => {
    const path = 'D:\\images\\a & b.png';
    const result = await placeViaCom(path, async (exe, args, options) => {
        assert.equal(exe, 'powershell.exe'); assert.equal(args.at(-1), path);
        assert.equal(options.windowsHide, true); return {stdout:'PLACED\n'};
    });
    assert.equal(result.method, 'windows-com');
    const opened = await placeViaCom(path, async () => ({ stdout: 'OPENED\n' }));
    assert.equal(opened.opened, true);
    assert.equal(opened.placed, undefined);
    await assert.rejects(placeViaCom(path, async () => { throw {stderr:'No document'}; }), /No document/);
});
test('closed Photoshop requires confirmation; confirmed action opens preserved resource without bridge', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'ps-launch-test-'));
    const previous = process.env.LOCALAPPDATA; process.env.LOCALAPPDATA = folder;
    const bytes = Buffer.from([137,80,78,71,13,10,26,10]);
    let launches = 0;
    const dependencies = { isRunning: async () => false, open: async path => { launches++; assert.deepEqual(await readFile(path), bytes); return { opened: true }; } };
    try {
        const payload = { base64: bytes.toString('base64') };
        assert.equal((await placeBrowserImage(payload, dependencies)).requiresConfirmation, true);
        assert.equal(launches, 0);
        assert.deepEqual(await placeBrowserImage({ ...payload, confirmOpen: true }, dependencies), { opened: true });
        assert.equal(launches, 1);
    } finally {
        previous === undefined ? delete process.env.LOCALAPPDATA : process.env.LOCALAPPDATA = previous;
        await rm(folder, { recursive: true, force: true });
    }
});
