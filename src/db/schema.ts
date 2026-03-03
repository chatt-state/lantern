export interface Institution {
  id: string;
  name: string;
  domain: string;
  azure_tenant_id: string;
  azure_client_id: string;
  azure_client_secret_enc: string;
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface User {
  id: string;
  institution_id: string;
  azure_oid: string;
  email: string;
  display_name: string;
  institution_admin: boolean;
  active: boolean;
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface Department {
  id: string;
  institution_id: string;
  name: string;
  description: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface GroupMapping {
  id: string;
  institution_id: string;
  azure_group_name: string;
  department_id: string;
  role: 'member' | 'department_admin';
  created_at: Date;
}

export interface UserDepartment {
  id: string;
  user_id: string;
  department_id: string;
  role: 'member' | 'department_admin';
  manual_override: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface ServerAccess {
  id: string;
  department_id: string;
  server_slug: string;
  enabled: boolean;
  created_at: Date;
}

export interface ToolAllowlist {
  id: string;
  department_id: string;
  server_slug: string;
  allowed_tools: string[];
  updated_at: Date;
}

export interface UserCredential {
  id: string;
  user_id: string;
  server_slug: string;
  ciphertext: string;
  iv: string;
  tag: string;
  updated_at: Date;
}

export interface OAuthClient {
  id: string;
  institution_id: string | null;
  client_id: string;
  client_name: string | null;
  redirect_uris: string[];
  created_at: Date;
}

export interface AuthCode {
  code: string;
  client_id: string;
  user_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  scope: string | null;
  session_id: string | null;
  expires_at: Date;
  created_at: Date;
}

export interface AccessToken {
  token_hash: string;
  user_id: string;
  client_id: string;
  scope: string | null;
  expires_at: Date;
  created_at: Date;
}

export interface RefreshToken {
  token_hash: string;
  access_token_hash: string;
  user_id: string;
  client_id: string;
  scope: string | null;
  revoked: boolean;
  expires_at: Date;
  created_at: Date;
}

export interface Session {
  id: string;
  user_id: string | null;
  data: Record<string, unknown>;
  expires_at: Date;
  created_at: Date;
  updated_at: Date;
}

export interface AuditLogEntry {
  id: string;
  institution_id: string;
  user_id: string | null;
  department_id: string | null;
  server_slug: string;
  tool_name: string | null;
  method: string;
  status_code: number | null;
  latency_ms: number | null;
  error: string | null;
  created_at: Date;
}

export interface AdminAuditLogEntry {
  id: string;
  institution_id: string;
  actor_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: Record<string, unknown> | null;
  created_at: Date;
}

export type UserRole = 'member' | 'department_admin';
