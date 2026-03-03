/**
 * HTTP transport for the TDX MCP server.
 * Implements MCP Streamable HTTP transport on port 8080.
 *
 * Endpoints:
 *   POST /mcp   — JSON-RPC MCP endpoint (stateless)
 *   GET  /health — Health check
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createTdxServer } from './server.js';

const PORT = parseInt(process.env['PORT'] ?? '8080', 10);

async function handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Parse body for POST requests
  let body: unknown;
  if (req.method === 'POST') {
    const raw = await new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
    try {
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid_json' }));
      return;
    }
  }

  // Create a fresh transport + server per request (stateless mode)
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless — gateway manages sessions
  });

  const mcpServer = createTdxServer();

  try {
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, body);
  } finally {
    await mcpServer.close();
  }
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = req.url ?? '/';

  if (url === '/health' || url === '/health/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', server: 'lantern-tdx' }));
    return;
  }

  if (url === '/mcp' || url === '/mcp/') {
    try {
      await handleMcp(req, res);
    } catch (err) {
      console.error('MCP handler error:', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'internal_error' }));
      }
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_found' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`TDX MCP server listening on port ${PORT}`);
});
