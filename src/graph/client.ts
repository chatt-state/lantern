/**
 * Creates a Microsoft Graph client authenticated with a user's delegated access token.
 * Uses the user's OIDC access token (from the Azure SSO flow) to make Graph API calls.
 */
import { Client } from '@microsoft/microsoft-graph-client';

export interface GraphGroup {
  id: string;
  displayName: string;
  '@odata.type': string;
}

/**
 * Creates a Graph client for the given user's access token.
 * The token must have GroupMember.Read.All delegated permission.
 */
export function createGraphClient(accessToken: string): Client {
  return Client.init({
    authProvider: (done) => {
      done(null, accessToken);
    },
  });
}

/**
 * Fetches the display names of all Azure AD groups the user is a member of.
 * Handles pagination via @odata.nextLink.
 * Returns only SecurityGroup and Microsoft365Group types (filters out other directory objects).
 */
export async function getUserGroups(accessToken: string): Promise<string[]> {
  const client = createGraphClient(accessToken);
  const groups: string[] = [];

  let response = await client.api('/me/memberOf').select('displayName,@odata.type').get();

  while (response) {
    for (const item of (response.value ?? []) as Record<string, unknown>[]) {
      const type = item['@odata.type'] as string;
      if (
        (type === '#microsoft.graph.group' || type === '#microsoft.graph.directoryRole') &&
        item.displayName
      ) {
        groups.push(item.displayName as string);
      }
    }

    if (response['@odata.nextLink']) {
      response = await client.api(response['@odata.nextLink'] as string).get();
    } else {
      break;
    }
  }

  return groups;
}
