/**
 * TDX REST API client.
 * Wraps the TeamDynamix Web API with typed methods for tickets,
 * knowledge base, assets, services, and people.
 */
import { TdxAuthService } from './auth.js';

export class TdxClient {
  constructor(private readonly auth: TdxAuthService, private readonly baseUrl: string) {}

  private async fetch(path: string, options?: RequestInit): Promise<unknown> {
    const token = await this.auth.getToken();
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`TDX API error ${response.status}: ${text}`);
    }
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  async searchTickets(appId: string, params: { keywords?: string; statusId?: number }): Promise<unknown> {
    const body = { Keywords: params.keywords ?? '', StatusID: params.statusId ?? 0 };
    return this.fetch(`/api/${appId}/tickets/search`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async getTicket(appId: string, id: number): Promise<unknown> {
    return this.fetch(`/api/${appId}/tickets/${id}`);
  }

  async createTicket(appId: string, data: object): Promise<unknown> {
    return this.fetch(`/api/${appId}/tickets`, { method: 'POST', body: JSON.stringify(data) });
  }

  async updateTicket(appId: string, id: number, data: object): Promise<unknown> {
    return this.fetch(`/api/${appId}/tickets/${id}`, { method: 'POST', body: JSON.stringify(data) });
  }

  async searchKb(kbAppId: string, searchText: string): Promise<unknown> {
    const params = new URLSearchParams({ searchText });
    return this.fetch(`/api/${kbAppId}/knowledgebase/search?${params}`);
  }

  async getArticle(kbAppId: string, id: number): Promise<unknown> {
    return this.fetch(`/api/${kbAppId}/knowledgebase/${id}`);
  }

  async searchAssets(assetAppId: string, params: { searchText?: string }): Promise<unknown> {
    const body = { SearchText: params.searchText ?? '' };
    return this.fetch(`/api/${assetAppId}/assets/search`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async getAsset(assetAppId: string, id: number): Promise<unknown> {
    return this.fetch(`/api/${assetAppId}/assets/${id}`);
  }

  async listServices(appId: string): Promise<unknown> {
    return this.fetch(`/api/${appId}/services`);
  }

  async getService(appId: string, id: number): Promise<unknown> {
    return this.fetch(`/api/${appId}/services/${id}`);
  }

  async searchPeople(searchText: string): Promise<unknown> {
    const params = new URLSearchParams({ searchText });
    return this.fetch(`/api/people/search?${params}`);
  }
}
