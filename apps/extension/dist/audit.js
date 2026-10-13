const AUDIT_KEY = 'bridgeAudit';
const MAX_AUDIT_ENTRIES = 100;
export async function appendAudit(entry) {
    const current = await getAudit();
    const next = [
        ...current,
        {
            ...entry,
            id: crypto.randomUUID(),
            at: new Date().toISOString()
        }
    ].slice(-MAX_AUDIT_ENTRIES);
    await chrome.storage.session.set({ [AUDIT_KEY]: next });
}
export async function getAudit(limit = 12) {
    const data = await chrome.storage.session.get(AUDIT_KEY);
    const entries = Array.isArray(data[AUDIT_KEY]) ? data[AUDIT_KEY] : [];
    return entries.slice(-Math.max(1, Math.min(limit, MAX_AUDIT_ENTRIES))).reverse();
}
export async function clearAudit() {
    await chrome.storage.session.remove(AUDIT_KEY);
}
