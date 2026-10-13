import { readdir, readFile, lstat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
const ownedName = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|gif|webp)$/i;
export async function clearExpiredPsCache(folder, progress = () => {}, now = Date.now()) {
    let count = 0;
    for (const entry of await readdir(folder, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.cache.json')) continue;
        const name = entry.name.slice(0, -11);
        if (!ownedName.test(name)) continue;
        const marker = join(folder, entry.name);
        try {
            const record = JSON.parse(await readFile(marker, 'utf8'));
            if (record.owner !== 'codex-ps-image' || record.file !== name || !Number.isFinite(record.createdAt) || now - record.createdAt < 86400000) continue;
            const path = join(folder, name);
            const stat = await lstat(path).catch(error => { if (error.code !== 'ENOENT') throw error; });
            if (stat && (!stat.isFile() || stat.isSymbolicLink())) continue;
            if (stat) await unlink(path);
            await unlink(marker); count++;
        } catch { progress('部分过期缓存暂时无法清理，将在下次使用时重试'); }
    }
    if (count) progress(`已清理 ${count} 个过期缓存`);
}
export async function removeSuccessfulPsCache(path, progress) {
    try {
        await unlink(path);
        await unlink(`${path}.cache.json`);
        progress('成功处理，下载缓存已删除');
    } catch { progress('图片处理成功；缓存暂时无法删除，将在下次使用时清理'); }
}
