/**
 * Calendar tools — list and create events via Microsoft Graph.
 */
import type { Client } from '@microsoft/microsoft-graph-client';

export interface CalendarEvent {
  id: string;
  subject: string;
  start: string;
  end: string;
  location: string;
  organizer: string;
}

export interface ListEventsParams {
  days?: number;
}

export interface CreateEventParams {
  subject: string;
  start: string;    // ISO 8601, e.g. "2026-03-10T14:00:00"
  end: string;      // ISO 8601
  timeZone?: string;
  location?: string;
  body?: string;
  attendees?: string[]; // email addresses
}

/** Lists upcoming events (next N days, default 7). */
export async function listEvents(
  graphClient: Client,
  params: ListEventsParams,
): Promise<CalendarEvent[]> {
  const days = params.days ?? 7;
  const now = new Date();
  const future = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  const response = await graphClient
    .api('/me/calendarView')
    .query({
      startDateTime: now.toISOString(),
      endDateTime: future.toISOString(),
    })
    .select('id,subject,start,end,location,organizer')
    .orderby('start/dateTime')
    .top(50)
    .get();

  return ((response.value ?? []) as Record<string, unknown>[]).map((evt) => ({
    id: evt['id'] as string,
    subject: (evt['subject'] as string) ?? '(no subject)',
    start:
      ((evt['start'] as Record<string, unknown>)?.['dateTime'] as string) ?? '',
    end: ((evt['end'] as Record<string, unknown>)?.['dateTime'] as string) ?? '',
    location:
      ((evt['location'] as Record<string, unknown>)?.['displayName'] as string) ?? '',
    organizer:
      (
        (evt['organizer'] as Record<string, unknown>)?.['emailAddress'] as Record<
          string,
          unknown
        >
      )?.['address'] as string ?? '',
  }));
}

/** Creates a new calendar event. */
export async function createEvent(
  graphClient: Client,
  params: CreateEventParams,
): Promise<Record<string, unknown>> {
  const timeZone = params.timeZone ?? 'UTC';

  const body: Record<string, unknown> = {
    subject: params.subject,
    start: { dateTime: params.start, timeZone },
    end: { dateTime: params.end, timeZone },
  };

  if (params.location) {
    body['location'] = { displayName: params.location };
  }

  if (params.body) {
    body['body'] = { contentType: 'Text', content: params.body };
  }

  if (params.attendees && params.attendees.length > 0) {
    body['attendees'] = params.attendees.map((email) => ({
      emailAddress: { address: email },
      type: 'required',
    }));
  }

  return graphClient.api('/me/events').post(body);
}
