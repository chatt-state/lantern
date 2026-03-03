/**
 * In-memory tool list cache with 5-minute TTL.
 * Fetches the tool list from an upstream MCP server using the MCP Streamable HTTP protocol.
 */

interface CacheEntry {
  tools: string[];
  expiresAt: number;
}

export class ToolCache {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttlMs = 5 * 60 * 1000; // 5 minutes

  async getTools(serverSlug: string, upstreamUrl: string): Promise<string[]> {
    const cached = this.cache.get(serverSlug);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.tools;
    }

    try {
      const tools = await this.fetchToolsFromServer(upstreamUrl);
      this.cache.set(serverSlug, { tools, expiresAt: Date.now() + this.ttlMs });
      return tools;
    } catch {
      // Return cached (stale) if available on error, else empty
      return cached?.tools ?? [];
    }
  }

  private async fetchToolsFromServer(upstreamUrl: string): Promise<string[]> {
    // MCP Streamable HTTP protocol: initialize → notifications/initialized → tools/list
    const mcpBase = upstreamUrl.endsWith('/mcp') ? upstreamUrl : `${upstreamUrl}/mcp`;

    // Step 1: initialize
    const initResponse = await fetch(mcpBase, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'lantern-gateway', version: '1.0.0' },
        },
      }),
    });

    const sessionId = initResponse.headers.get('Mcp-Session-Id') ?? '';
    const initBody = await initResponse.text();

    // Parse session ID from SSE if needed
    let mcpSessionId = sessionId;
    if (!mcpSessionId && initBody.includes('data:')) {
      // SSE format — extract session from event data
      // For now just proceed without session
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };
    if (mcpSessionId) headers['Mcp-Session-Id'] = mcpSessionId;

    // Step 2: notifications/initialized
    await fetch(mcpBase, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }),
    });

    // Step 3: tools/list
    const toolsResponse = await fetch(mcpBase, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
    });

    const toolsText = await toolsResponse.text();

    // Handle SSE or JSON response
    let toolsData: unknown;
    if (toolsText.startsWith('data:')) {
      const dataLine = toolsText.split('\n').find((l) => l.startsWith('data:'));
      if (dataLine) toolsData = JSON.parse(dataLine.slice(5).trim());
    } else {
      toolsData = JSON.parse(toolsText);
    }

    const tools: string[] = ((toolsData as any)?.result?.tools ?? []).map((t: any) => t.name as string);
    return tools;
  }

  invalidate(serverSlug: string): void {
    this.cache.delete(serverSlug);
  }

  clear(): void {
    this.cache.clear();
  }
}
