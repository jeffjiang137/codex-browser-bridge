import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { BrowserBridge } from './bridge.js';
import { registerBrowserTools } from './tools.js';
const port = Number(process.env.CODEX_BROWSER_BRIDGE_PORT || 17373);
const bridge = new BrowserBridge('127.0.0.1', port);
function createServer() {
    const server = new McpServer({ name: 'codex-browser-bridge', version: '0.2.0' });
    registerBrowserTools(server, bridge);
    return server;
}
const handle = serveStdio(createServer);
console.error('[browser-bridge] MCP server running on stdio');
async function shutdown() {
    try {
        await handle.close();
    }
    finally {
        await bridge.close().catch(() => undefined);
        process.exit(0);
    }
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
