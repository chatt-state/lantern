/**
 * Directory tools — look up users in Azure AD via Microsoft Graph.
 */
import type { Client } from '@microsoft/microsoft-graph-client';

export interface DirectoryUser {
  id: string;
  displayName: string;
  mail: string;
  jobTitle: string;
  department: string;
}

export interface GetUserParams {
  email?: string;
  displayName?: string;
}

export interface ListUsersParams {
  search?: string;
  top?: number;
}

function mapUser(item: Record<string, unknown>): DirectoryUser {
  return {
    id: item['id'] as string,
    displayName: (item['displayName'] as string) ?? '',
    mail: (item['mail'] as string) ?? '',
    jobTitle: (item['jobTitle'] as string) ?? '',
    department: (item['department'] as string) ?? '',
  };
}

/** Looks up a single user by email address or display name. */
export async function getUser(
  graphClient: Client,
  params: GetUserParams,
): Promise<DirectoryUser | null> {
  if (!params.email && !params.displayName) {
    throw new Error('Either email or displayName must be provided');
  }

  const filter = params.email
    ? `mail eq '${params.email}'`
    : `displayName eq '${params.displayName}'`;

  const response = await graphClient
    .api('/users')
    .filter(filter)
    .select('id,displayName,mail,jobTitle,department')
    .top(1)
    .get();

  const items = (response.value ?? []) as Record<string, unknown>[];
  return items.length > 0 ? mapUser(items[0]) : null;
}

/** Searches users in the directory by display name or email. */
export async function listUsers(
  graphClient: Client,
  params: ListUsersParams,
): Promise<DirectoryUser[]> {
  const top = params.top ?? 20;

  let apiCall = graphClient
    .api('/users')
    .select('id,displayName,mail,jobTitle,department')
    .top(top);

  if (params.search) {
    // Use $search for broader matching (requires ConsistencyLevel header)
    apiCall = apiCall
      .header('ConsistencyLevel', 'eventual')
      .search(`"displayName:${params.search}" OR "mail:${params.search}"`);
  }

  const response = await apiCall.get();
  return ((response.value ?? []) as Record<string, unknown>[]).map(mapUser);
}
