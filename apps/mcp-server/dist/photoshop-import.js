import { mkdir, writeFile, readdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { clearExpiredPsCache, removeSuccessfulPsCache } from './ps-cache.js';
const execute = promisify(execFile);
export async function placeViaCom(path, runner = execute, openImage = false) {
    try {
        const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', fileURLToPath(new URL('./photoshop-place.ps1', import.meta.url)), '-ImagePath', path];
        if (openImage) args.push('-OpenImage');
        const { stdout } = await runner('powershell.exe', args, { windowsHide: true, timeout: 60000, maxBuffer: 65536, encoding: 'utf8' });
        if (stdout.trim() === 'OPENED') return { opened: true, method: 'windows-com', message: 'PS 没有目标文档，已将原图打开为新文档' };
        if (stdout.trim() !== 'PLACED') throw new Error('COM 未返回置入成功标记');
        return { placed: true, method: 'windows-com', message: '已通过 Windows COM 置入 Photoshop' };
    } catch (error) {
        throw new Error(`Photoshop COM 置入失败：${String(error.stderr || error.message).trim().slice(0, 800)}。请确认 PS 已打开目标文档且没有未关闭的对话框；超时时请先检查图层再重试。`);
    }
}
export async function photoshopRunning() {
    const { stdout } = await execute('tasklist.exe', ['/FI', 'IMAGENAME eq Photoshop.exe', '/FO', 'CSV', '/NH'], { windowsHide: true });
    return /^"Photoshop\.exe"/im.test(stdout);
}
export async function openInPhotoshop(path) {
    const candidates = [];
    if (process.env.PS_EXECUTABLE) candidates.push(process.env.PS_EXECUTABLE);
    // App Paths records the Photoshop installation selected by Windows.
    const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "$keys=@('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Photoshop.exe','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Photoshop.exe'); foreach($key in $keys){if(Test-Path -LiteralPath $key){(Get-Item -LiteralPath $key).GetValue('')}}"], { windowsHide: true });
    candidates.push(...stdout.split(/\r?\n/).map(value => value.trim().replace(/^"|"$/g, '')).filter(Boolean));
    for (const base of [process.env.ProgramW6432, process.env.ProgramFiles].filter(Boolean)) {
        const adobe = join(base, 'Adobe');
        const names = await readdir(adobe).catch(() => []);
        names.sort((a, b) => Number(a.includes('Beta')) - Number(b.includes('Beta')) || b.localeCompare(a, undefined, { numeric: true }));
        for (const name of names.filter(name => name.startsWith('Adobe Photoshop'))) candidates.push(join(adobe, name, 'Photoshop.exe'));
    }
    for (const executable of candidates) {
        if (!/Photoshop\.exe$/i.test(executable)) continue;
        try { await access(executable); } catch { continue; }
        await new Promise((resolve, reject) => {
            const child = spawn(executable, [], { detached: true, stdio: 'ignore', windowsHide: false });
            child.once('error', reject); child.once('spawn', () => { child.unref(); resolve(); });
        });
        for (let attempt = 0; attempt < 30; attempt++) {
            if (await photoshopRunning()) {
                try { return await placeViaCom(path, execute, true); }
                catch (error) {
                    if (!/0x800401E3|0x800401E5|MK_E_UNAVAILABLE|操作不可用|Operation unavailable/i.test(error.message)) throw error;
                }
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        throw new Error('Photoshop 启动后尚未就绪，原图缓存保留一天，请稍后重试');
    }
    throw new Error('未找到 Photoshop，请先安装 PS，或设置 PS_EXECUTABLE 为 Photoshop.exe 完整路径');
}
export async function placeBrowserImage(payload, dependencies = {}) {
    const progress = dependencies.progress || (() => {});
    progress('检查图片资源格式');
    const bytes = Buffer.from(payload.base64 || '', 'base64');
    if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error('图片为空或超过 20MB');
    const ext = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'png'
        : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'jpg'
        : bytes.subarray(0, 6).toString().match(/^GIF8[79]a$/) ? 'gif'
        : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP' ? 'webp' : null;
    if (!ext) throw new Error('仅支持 PNG、JPEG、GIF、WebP 原图资源');
    const folder = join(process.env.LOCALAPPDATA || process.env.TEMP, 'CodexBrowserBridge', 'photoshop-images');
    await mkdir(folder, { recursive: true });
    await clearExpiredPsCache(folder, progress);
    progress('检查 Photoshop 进程');
    const running = await (dependencies.isRunning || photoshopRunning)();
    progress(`Photoshop 进程=${running ? '已打开' : '未打开'}`);
    if (!running && payload.confirmOpen !== true) return { requiresConfirmation: true, message: 'Photoshop 没有打开。是否启动 PS 并在 PS 中打开这张图片？' };
    const path = join(folder, `${randomUUID()}.${ext}`);
    await writeFile(path, bytes, { flag: 'wx' });
    await writeFile(`${path}.cache.json`, JSON.stringify({ owner: 'codex-ps-image', file: path.slice(folder.length + 1), createdAt: Date.now() }), { flag: 'wx' });
    progress('原图资源已保存');
    if (payload.confirmOpen === true) {
        const result = await (dependencies.open || openInPhotoshop)(path);
        if (result.opened === true) await removeSuccessfulPsCache(path, progress);
        return result;
    }
    progress('开始调用 Windows COM 置入');
    const result = await (dependencies.place || placeViaCom)(path);
    progress('Windows COM 置入完成');
    if (result.placed === true || result.opened === true) await removeSuccessfulPsCache(path, progress);
    return result;
}
