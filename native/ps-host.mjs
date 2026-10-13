import { placeBrowserImage } from '../apps/mcp-server/dist/photoshop-import.js';
let input = Buffer.alloc(0), chunks = [], size = 0, executing = false;
function send(message) {
    const bytes = Buffer.from(JSON.stringify(message)); const header = Buffer.alloc(4); header.writeUInt32LE(bytes.length);
    process.stdout.write(Buffer.concat([header, bytes]));
}
async function handle(message) {
    try {
        if (executing) throw new Error('图片正在处理');
        if (message.type === 'start') { chunks = []; size = 0; send({ type: 'ready' }); }
        else if (message.type === 'chunk') {
            if (typeof message.value !== 'string' || !/^[A-Za-z0-9+/=]*$/.test(message.value)) throw new Error('图片编码无效');
            size += message.value.length; if (size > 28 * 1024 * 1024) throw new Error('图片超过限制');
            chunks.push(message.value); send({ type: 'ack' });
        } else if (message.type === 'execute') {
            executing = true;
            const payload = { base64: chunks.join(''), confirmOpen: message.confirmOpen === true }; chunks = [];
            const result = await placeBrowserImage(payload, { progress: detail => send({ type: 'progress', detail }) });
            send({ type: 'result', ok: true, result });
        } else throw new Error('未知本机通信消息');
    } catch (error) { send({ type: 'result', ok: false, error: error.message }); }
}
process.stdin.on('data', bytes => {
    input = Buffer.concat([input, bytes]);
    while (input.length >= 4) {
        const length = input.readUInt32LE(0);
        if (length > 512 * 1024) { process.exitCode = 1; process.stdin.destroy(); return; }
        if (input.length < length + 4) return;
        const body = input.subarray(4, length + 4); input = input.subarray(length + 4);
        try { void handle(JSON.parse(body.toString('utf8'))); }
        catch { send({ type: 'result', ok: false, error: '本机消息格式错误' }); }
    }
});
