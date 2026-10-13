import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
export async function validateUploadFiles(inputPaths) {
    const roots = await allowedRoots();
    const files = [];
    const metadata = [];
    for (const input of inputPaths) {
        const absolute = path.isAbsolute(input) ? input : path.resolve(process.cwd(), input);
        let resolved;
        try {
            resolved = await realpath(absolute);
        }
        catch {
            throw new Error(`上传文件不存在或无法访问: ${input}`);
        }
        const info = await stat(resolved);
        if (!info.isFile())
            throw new Error(`上传路径不是文件: ${input}`);
        if (!roots.some((root) => isInside(root, resolved))) {
            throw new Error(`拒绝上传工作区外文件: ${resolved}。默认只允许 MCP 工作目录；如确需其他目录，请设置 CODEX_BROWSER_BRIDGE_UPLOAD_ROOTS。`);
        }
        files.push(resolved);
        metadata.push({ path: resolved, size: info.size });
    }
    return { files, metadata, allowedRoots: roots };
}
async function allowedRoots() {
    const configured = process.env.CODEX_BROWSER_BRIDGE_UPLOAD_ROOTS
        ?.split(path.delimiter)
        .map((item) => item.trim())
        .filter(Boolean);
    const roots = configured?.length ? configured : [process.cwd()];
    return Promise.all(roots.map(async (root) => {
        const absolute = path.isAbsolute(root) ? root : path.resolve(process.cwd(), root);
        try {
            return await realpath(absolute);
        }
        catch {
            return absolute;
        }
    }));
}
function isInside(root, file) {
    const relative = path.relative(root, file);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
