let queue = Promise.resolve();
export function logPs(stage, detail = '', requestId = '') {
    queue = queue.catch(() => {}).then(async () => {
        const { psDebug = [] } = await chrome.storage.local.get('psDebug');
        psDebug.push({ time: new Date().toISOString(), stage, requestId, detail: String(detail).slice(0, 1200) });
        await chrome.storage.local.set({ psDebug: psDebug.slice(-200) });
    });
    return queue;
}
export async function readPsLogs() { await queue.catch(() => {}); return (await chrome.storage.local.get('psDebug')).psDebug || []; }
