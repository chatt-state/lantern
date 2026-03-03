import type { Sql } from 'postgres';
import type { Institution } from '../db/schema.js';

export class InstitutionService {
  constructor(private readonly sql: Sql) {}

  async findByTenantId(azureTenantId: string): Promise<Institution | null> {
    const [inst] = await this.sql<Institution[]>`
      SELECT * FROM institutions WHERE azure_tenant_id = ${azureTenantId} AND active = true
    `;
    return inst ?? null;
  }

  async findById(id: string): Promise<Institution | null> {
    const [inst] = await this.sql<Institution[]>`
      SELECT * FROM institutions WHERE id = ${id} AND active = true
    `;
    return inst ?? null;
  }

  async initTables(): Promise<void> {
    // Tables are created by migrations; this is a no-op for now
  }
}
