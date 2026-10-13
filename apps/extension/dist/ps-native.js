import { logPs } from './ps-debug.js';
let busy = false;
export async function importNativeImage(base64, confirmOpen, requestId) {
    if (busy) throw new Error('上一张图片正在处理，请稍候');
    busy = true;
    let port;
    try {
        port = chrome.runtime.connectNative('com.codex.browser.photoshop');
        return await new Promise((resolve, reject) => {
            let offset = 0;
            const timer = setTimeout(() => reject(new Error('本机 PS 处理超时，请检查 PS 图层后重试')), 100000);
            function chunk() {
                if (offset < base64.length) {
                    const value = base64.slice(offset, offset + 192 * 1024); offset += value.length;
                    port.postMessage({ type: 'chunk', value });
                } else port.postMessage({ type: 'execute', confirmOpen });
            }
            port.onMessage.addListener(message => {
                if (message.type === 'ready' || message.type === 'ack') chunk();
                if (message.type === 'progress') void logPs('native.progress', message.detail, requestId);
                if (message.type === 'result') {
                    clearTimeout(timer); message.ok ? resolve(message.result) : reject(new Error(message.error));
                }
            });
            port.onDisconnect.addListener(() => {
                const error = chrome.runtime.lastError?.message;
                clearTimeout(timer);
                reject(new Error(`本机 PS 组件断开：${error || '连接关闭'}。请运行 install-ps-native.ps1 注册组件；扩展 ID：${chrome.runtime.id}`));
            });
            port.postMessage({ type: 'start' });
        });
    } finally { port?.disconnect(); busy = false; }
}
