/**
 * OneDrive/Files tools — list and get files via Microsoft Graph.
 */
import type { Client } from '@microsoft/microsoft-graph-client';

export interface DriveItem {
  id: string;
  name: string;
  size: number;
  type: 'file' | 'folder';
  lastModified: string;
  webUrl: string;
}

export interface ListFilesParams {
  folderId?: string; // item ID of folder; omit for root
}

export interface GetFileParams {
  id: string;
}

/** Lists OneDrive items at the root or in a specific folder. */
export async function listFiles(
  graphClient: Client,
  params: ListFilesParams,
): Promise<DriveItem[]> {
  const endpoint = params.folderId
    ? `/me/drive/items/${params.folderId}/children`
    : '/me/drive/root/children';

  const response = await graphClient
    .api(endpoint)
    .select('id,name,size,folder,file,lastModifiedDateTime,webUrl')
    .top(50)
    .get();

  return ((response.value ?? []) as Record<string, unknown>[]).map((item) => ({
    id: item['id'] as string,
    name: item['name'] as string,
    size: (item['size'] as number) ?? 0,
    type: item['folder'] ? 'folder' : 'file',
    lastModified: (item['lastModifiedDateTime'] as string) ?? '',
    webUrl: (item['webUrl'] as string) ?? '',
  }));
}

/** Gets metadata for a specific OneDrive item by ID. */
export async function getFile(
  graphClient: Client,
  params: GetFileParams,
): Promise<Record<string, unknown>> {
  return graphClient
    .api(`/me/drive/items/${params.id}`)
    .select('id,name,size,folder,file,lastModifiedDateTime,webUrl,parentReference,createdBy')
    .get();
}
