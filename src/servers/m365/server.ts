/**
 * M365 MCP Server definition.
 * Registers all Mail, Calendar, Files, and Directory tools.
 *
 * Each tool extracts the Bearer token from X-Lantern-Access-Token (injected
 * by the Lantern proxy), creates a Graph client, and calls the relevant function.
 */
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerRequest, ServerNotification } from '@modelcontextprotocol/sdk/types.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { createGraphClient } from '../../graph/client.js';
import { listMail, getMail, searchMail, sendMail } from './tools/mail.js';
import { listEvents, createEvent } from './tools/calendar.js';
import { listFiles, getFile } from './tools/files.js';
import { getUser, listUsers } from './tools/directory.js';

type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

/**
 * Extracts the access token from the X-Lantern-Access-Token header.
 * The gateway proxy injects this header before forwarding to the upstream server.
 */
function getAccessToken(extra: ToolExtra): string {
  const headers = extra.requestInfo?.headers;
  if (headers) {
    const token =
      headers['x-lantern-access-token'] ?? headers['X-Lantern-Access-Token'];
    if (token) {
      return Array.isArray(token) ? token[0] : token;
    }
  }
  throw new Error('Missing X-Lantern-Access-Token header — authentication required');
}

/** Creates and configures the M365 MCP server with all tools registered. */
export function createM365Server(): McpServer {
  const server = new McpServer({
    name: 'lantern-m365',
    version: '1.0.0',
  });

  // ── Mail tools ──────────────────────────────────────────────────────────────

  server.tool(
    'list_mail',
    'List inbox email messages (most recent first)',
    { top: z.number().optional().describe('Number of messages to return (default 20)') },
    async (args, extra) => {
      const token = getAccessToken(extra);
      const client = createGraphClient(token);
      const messages = await listMail(client, { top: args.top });
      return { content: [{ type: 'text', text: JSON.stringify(messages, null, 2) }] };
    },
  );

  server.tool(
    'get_mail',
    'Get a single email message by ID',
    { id: z.string().describe('Message ID') },
    async (args, extra) => {
      const token = getAccessToken(extra);
      const client = createGraphClient(token);
      const message = await getMail(client, { id: args.id });
      return { content: [{ type: 'text', text: JSON.stringify(message, null, 2) }] };
    },
  );

  server.tool(
    'search_mail',
    'Search email messages using a query string',
    { query: z.string().describe('Search query') },
    async (args, extra) => {
      const token = getAccessToken(extra);
      const client = createGraphClient(token);
      const messages = await searchMail(client, { query: args.query });
      return { content: [{ type: 'text', text: JSON.stringify(messages, null, 2) }] };
    },
  );

  server.tool(
    'send_mail',
    'Send a new email message',
    {
      to: z.string().describe('Recipient email address'),
      subject: z.string().describe('Email subject'),
      body: z.string().describe('Email body content'),
      contentType: z.enum(['text', 'html']).optional().describe('Body content type (default: text)'),
    },
    async (args, extra) => {
      const token = getAccessToken(extra);
      const client = createGraphClient(token);
      await sendMail(client, {
        to: args.to,
        subject: args.subject,
        body: args.body,
        contentType: args.contentType,
      });
      return { content: [{ type: 'text', text: 'Email sent successfully' }] };
    },
  );

  // ── Calendar tools ───────────────────────────────────────────────────────────

  server.tool(
    'list_events',
    'List upcoming calendar events (next 7 days by default)',
    { days: z.number().optional().describe('Number of days ahead to look (default 7)') },
    async (args, extra) => {
      const token = getAccessToken(extra);
      const client = createGraphClient(token);
      const events = await listEvents(client, { days: args.days });
      return { content: [{ type: 'text', text: JSON.stringify(events, null, 2) }] };
    },
  );

  server.tool(
    'create_event',
    'Create a new calendar event',
    {
      subject: z.string().describe('Event subject/title'),
      start: z.string().describe('Start datetime (ISO 8601, e.g. 2026-03-10T14:00:00)'),
      end: z.string().describe('End datetime (ISO 8601)'),
      timeZone: z.string().optional().describe('IANA timezone name (default UTC)'),
      location: z.string().optional().describe('Event location'),
      body: z.string().optional().describe('Event description'),
      attendees: z.array(z.string()).optional().describe('Attendee email addresses'),
    },
    async (args, extra) => {
      const token = getAccessToken(extra);
      const client = createGraphClient(token);
      const event = await createEvent(client, args);
      return { content: [{ type: 'text', text: JSON.stringify(event, null, 2) }] };
    },
  );

  // ── Files tools ──────────────────────────────────────────────────────────────

  server.tool(
    'list_files',
    'List OneDrive files and folders (root or a specific folder)',
    { folderId: z.string().optional().describe('Folder item ID (omit for root)') },
    async (args, extra) => {
      const token = getAccessToken(extra);
      const client = createGraphClient(token);
      const items = await listFiles(client, { folderId: args.folderId });
      return { content: [{ type: 'text', text: JSON.stringify(items, null, 2) }] };
    },
  );

  server.tool(
    'get_file',
    'Get metadata for a specific OneDrive file or folder by item ID',
    { id: z.string().describe('OneDrive item ID') },
    async (args, extra) => {
      const token = getAccessToken(extra);
      const client = createGraphClient(token);
      const item = await getFile(client, { id: args.id });
      return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
    },
  );

  // ── Directory tools ──────────────────────────────────────────────────────────

  server.tool(
    'get_user',
    'Look up a user in the directory by email or display name',
    {
      email: z.string().optional().describe('User email address'),
      displayName: z.string().optional().describe('User display name'),
    },
    async (args, extra) => {
      const token = getAccessToken(extra);
      const client = createGraphClient(token);
      const user = await getUser(client, { email: args.email, displayName: args.displayName });
      return { content: [{ type: 'text', text: JSON.stringify(user, null, 2) }] };
    },
  );

  server.tool(
    'list_users',
    'Search for users in the directory',
    {
      search: z.string().optional().describe('Search term (matches display name or email)'),
      top: z.number().optional().describe('Number of results to return (default 20)'),
    },
    async (args, extra) => {
      const token = getAccessToken(extra);
      const client = createGraphClient(token);
      const users = await listUsers(client, { search: args.search, top: args.top });
      return { content: [{ type: 'text', text: JSON.stringify(users, null, 2) }] };
    },
  );

  return server;
}
