/**
 * Registry of known MCP server slugs and their upstream URLs.
 * URL comes from environment variables (SERVER_URL_<SLUG>).
 */
import { config } from '../config.js';

export interface McpServer {
  slug: string;
  displayName: string;
  upstreamUrl: string;
}

const SERVERS: McpServer[] = [
  {
    slug: 'm365',
    displayName: 'Microsoft 365',
    upstreamUrl: config.serverUrls.m365,
  },
];

const serverMap = new Map<string, McpServer>(SERVERS.map((s) => [s.slug, s]));

export function getServer(slug: string): McpServer | null {
  return serverMap.get(slug) ?? null;
}

export function listServers(): McpServer[] {
  return SERVERS;
}
