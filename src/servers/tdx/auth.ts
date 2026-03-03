/**
 * TDX BEID authentication service.
 * Application-level auth — all API calls share one token.
 * Token is valid for ~8 hours; we refresh after 7.
 */

const TOKEN_TTL_MS = 7 * 60 * 60 * 1000; // 7 hours

export class TdxAuthService {
  private token: string | null = null;
  private loginAt: number = 0;

  constructor(
    private readonly baseUrl: string,
    private readonly beid: string,
    private readonly webServicesKey: string,
  ) {}

  async getToken(): Promise<string> {
    if (this.token && Date.now() - this.loginAt < TOKEN_TTL_MS) {
      return this.token;
    }
    return this.login();
  }

  private async login(): Promise<string> {
    const response = await fetch(`${this.baseUrl}/api/auth/loginadmin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ BEID: this.beid, WebServicesKey: this.webServicesKey }),
    });
    if (!response.ok) {
      throw new Error(`TDX login failed: ${response.status}`);
    }
    this.token = await response.text(); // TDX returns raw token string
    this.loginAt = Date.now();
    return this.token;
  }
}
