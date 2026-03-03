/**
 * TDX MCP Server definition.
 * Registers tools for tickets, knowledge base, assets, services, and people.
 *
 * Uses application-level BEID auth — no per-user tokens needed.
 */
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { TdxAuthService } from './auth.js';
import { TdxClient } from './client.js';

const TICKET_APP_ID = process.env['TDX_TICKET_APP_ID'] ?? '';
const KB_APP_ID = process.env['TDX_KB_APP_ID'] ?? '';
const ASSET_APP_ID = process.env['TDX_ASSET_APP_ID'] ?? '';

const auth = new TdxAuthService(
  process.env['TDX_BASE_URL'] ?? 'https://ithelp.chattstate.edu/TDWebApi',
  process.env['TDX_BEID'] ?? '',
  process.env['TDX_WEB_SERVICES_KEY'] ?? '',
);
const client = new TdxClient(auth, process.env['TDX_BASE_URL'] ?? 'https://ithelp.chattstate.edu/TDWebApi');

/** Creates and configures the TDX MCP server with all tools registered. */
export function createTdxServer(): McpServer {
  const server = new McpServer({
    name: 'lantern-tdx',
    version: '1.0.0',
  });

  // ── Ticket tools ────────────────────────────────────────────────────────────

  server.tool(
    'search_tickets',
    'Search for help desk tickets by keywords or status',
    {
      keywords: z.string().optional().describe('Search keywords'),
      statusId: z.number().optional().describe('Filter by status ID'),
    },
    async (args) => {
      try {
        const result = await client.searchTickets(TICKET_APP_ID, args);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
      }
    },
  );

  server.tool(
    'get_ticket',
    'Get a single help desk ticket by ID',
    { id: z.number().describe('Ticket ID') },
    async (args) => {
      try {
        const result = await client.getTicket(TICKET_APP_ID, args.id);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
      }
    },
  );

  server.tool(
    'create_ticket',
    'Create a new help desk ticket',
    {
      title: z.string().describe('Ticket title'),
      description: z.string().describe('Ticket description'),
      requestorEmail: z.string().optional().describe('Requestor email address'),
    },
    async (args) => {
      try {
        const result = await client.createTicket(TICKET_APP_ID, {
          Title: args.title,
          Description: args.description,
          RequestorEmail: args.requestorEmail,
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
      }
    },
  );

  server.tool(
    'update_ticket',
    'Update an existing help desk ticket',
    {
      id: z.number().describe('Ticket ID'),
      comment: z.string().optional().describe('Comment to add'),
      newStatusId: z.number().optional().describe('New status ID'),
    },
    async (args) => {
      try {
        const result = await client.updateTicket(TICKET_APP_ID, args.id, {
          NewStatusID: args.newStatusId,
          Comments: args.comment,
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
      }
    },
  );

  // ── Knowledge Base tools ────────────────────────────────────────────────────

  server.tool(
    'search_knowledge_base',
    'Search the knowledge base for articles',
    { query: z.string().describe('Search query') },
    async (args) => {
      try {
        const result = await client.searchKb(KB_APP_ID, args.query);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
      }
    },
  );

  server.tool(
    'get_article',
    'Get a single knowledge base article by ID',
    { id: z.number().describe('Article ID') },
    async (args) => {
      try {
        const result = await client.getArticle(KB_APP_ID, args.id);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
      }
    },
  );

  // ── Asset tools ─────────────────────────────────────────────────────────────

  server.tool(
    'search_assets',
    'Search for IT assets',
    { query: z.string().optional().describe('Search query') },
    async (args) => {
      try {
        const result = await client.searchAssets(ASSET_APP_ID, { searchText: args.query });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
      }
    },
  );

  server.tool(
    'get_asset',
    'Get a single IT asset by ID',
    { id: z.number().describe('Asset ID') },
    async (args) => {
      try {
        const result = await client.getAsset(ASSET_APP_ID, args.id);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
      }
    },
  );

  // ── Service tools ───────────────────────────────────────────────────────────

  server.tool(
    'list_services',
    'List all service catalog entries',
    {},
    async () => {
      try {
        const result = await client.listServices(TICKET_APP_ID);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
      }
    },
  );

  server.tool(
    'get_service',
    'Get a single service catalog entry by ID',
    { id: z.number().describe('Service ID') },
    async (args) => {
      try {
        const result = await client.getService(TICKET_APP_ID, args.id);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
      }
    },
  );

  // ── People tools ────────────────────────────────────────────────────────────

  server.tool(
    'search_people',
    'Search for people in TeamDynamix',
    { query: z.string().describe('Search query (name or email)') },
    async (args) => {
      try {
        const result = await client.searchPeople(args.query);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
      }
    },
  );

  return server;
}
