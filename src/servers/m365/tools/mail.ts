/**
 * Mail tools — list, get, search, and send email via Microsoft Graph.
 */
import type { Client } from '@microsoft/microsoft-graph-client';

export interface MailMessage {
  id: string;
  subject: string;
  from: string;
  date: string;
  preview: string;
}

export interface ListMailParams {
  top?: number;
}

export interface GetMailParams {
  id: string;
}

export interface SearchMailParams {
  query: string;
}

export interface SendMailParams {
  to: string;
  subject: string;
  body: string;
  contentType?: 'text' | 'html';
}

/** Lists inbox messages (top N, default 20). Returns subject/from/date/preview. */
export async function listMail(
  graphClient: Client,
  params: ListMailParams,
): Promise<MailMessage[]> {
  const top = params.top ?? 20;
  const response = await graphClient
    .api('/me/mailFolders/inbox/messages')
    .top(top)
    .select('id,subject,from,receivedDateTime,bodyPreview')
    .orderby('receivedDateTime desc')
    .get();

  return ((response.value ?? []) as Record<string, unknown>[]).map((msg) => ({
    id: msg['id'] as string,
    subject: (msg['subject'] as string) ?? '(no subject)',
    from:
      ((msg['from'] as Record<string, unknown>)?.['emailAddress'] as Record<string, unknown>)?.[
        'address'
      ] as string ?? '',
    date: msg['receivedDateTime'] as string,
    preview: (msg['bodyPreview'] as string) ?? '',
  }));
}

/** Gets a single message by ID. */
export async function getMail(
  graphClient: Client,
  params: GetMailParams,
): Promise<Record<string, unknown>> {
  return graphClient
    .api(`/me/messages/${params.id}`)
    .select('id,subject,from,toRecipients,receivedDateTime,body,bodyPreview')
    .get();
}

/** Searches messages using $search query. */
export async function searchMail(
  graphClient: Client,
  params: SearchMailParams,
): Promise<MailMessage[]> {
  const response = await graphClient
    .api('/me/messages')
    .search(`"${params.query}"`)
    .select('id,subject,from,receivedDateTime,bodyPreview')
    .top(20)
    .get();

  return ((response.value ?? []) as Record<string, unknown>[]).map((msg) => ({
    id: msg['id'] as string,
    subject: (msg['subject'] as string) ?? '(no subject)',
    from:
      ((msg['from'] as Record<string, unknown>)?.['emailAddress'] as Record<string, unknown>)?.[
        'address'
      ] as string ?? '',
    date: msg['receivedDateTime'] as string,
    preview: (msg['bodyPreview'] as string) ?? '',
  }));
}

/** Sends a new email. */
export async function sendMail(
  graphClient: Client,
  params: SendMailParams,
): Promise<void> {
  await graphClient.api('/me/sendMail').post({
    message: {
      subject: params.subject,
      body: {
        contentType: params.contentType === 'html' ? 'HTML' : 'Text',
        content: params.body,
      },
      toRecipients: [
        {
          emailAddress: { address: params.to },
        },
      ],
    },
  });
}
