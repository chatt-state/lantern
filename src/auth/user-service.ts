import type { Sql } from 'postgres';
import type { User } from '../db/schema.js';

export interface AzureIdTokenClaims {
  oid: string; // Azure AD object ID — stable user identifier
  email?: string;
  preferred_username?: string;
  name?: string;
  tid: string; // Azure tenant ID
}

export class UserService {
  constructor(private readonly sql: Sql) {}

  async upsertUser(institutionId: string, claims: AzureIdTokenClaims): Promise<User> {
    const email = claims.email ?? claims.preferred_username ?? '';
    const displayName = claims.name ?? email;

    const [user] = await this.sql<User[]>`
      INSERT INTO users (institution_id, azure_oid, email, display_name, last_login_at)
      VALUES (${institutionId}, ${claims.oid}, ${email}, ${displayName}, now())
      ON CONFLICT (institution_id, azure_oid) DO UPDATE SET
        email = EXCLUDED.email,
        display_name = EXCLUDED.display_name,
        last_login_at = now(),
        updated_at = now()
      RETURNING *
    `;
    return user;
  }

  async findByAzureOid(institutionId: string, azureOid: string): Promise<User | null> {
    const [user] = await this.sql<User[]>`
      SELECT * FROM users
      WHERE institution_id = ${institutionId} AND azure_oid = ${azureOid} AND active = true
    `;
    return user ?? null;
  }

  async findById(userId: string): Promise<User | null> {
    const [user] = await this.sql<User[]>`
      SELECT * FROM users WHERE id = ${userId} AND active = true
    `;
    return user ?? null;
  }
}
