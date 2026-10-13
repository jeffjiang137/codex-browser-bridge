const SESSION_KEY = 'bridgeWindowAuthorization';
export async function getState() {
    const data = await chrome.storage.local.get(SESSION_KEY);
    const state = data[SESSION_KEY];
    return state ?? {};
}
export async function setState(state) {
    await chrome.storage.local.set({ [SESSION_KEY]: state });
}
export async function patchState(update) {
    const state = await getState();
    const next = { ...state, ...update };
    await setState(next);
    return next;
}
