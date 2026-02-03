/**
 * Siyuan-Share API Client for dynamic token fulfillment
 *
 * Environment variables required:
 * - SIYUAN_SHARE_API_URL: Base URL (e.g., https://siyuan-share.example.com)
 * - SIYUAN_SHARE_ADMIN_USERNAME: Admin username
 * - SIYUAN_SHARE_ADMIN_PASSWORD: Admin password
 */

interface LoginResponse {
    code: number;
    msg: string;
    data?: {
        token: string;
    };
}

interface CreateTokenResponse {
    code: number;
    msg: string;
    data?: {
        id: string;
        name: string;
        token: string;
        userId: string;
        username: string;
        createdAt: string;
    };
}

export class SiyuanShareUserNotFoundError extends Error {
    constructor(linuxDoId: string) {
        super(`用户未在 Siyuan-Share 注册，请先前往 https://siyuan-share.20210929.xyz/ 使用L站账号登录`);
        this.name = 'SiyuanShareUserNotFoundError';
    }
}

let cachedJwtToken: string | null = null;
let cachedJwtExpiry: number = 0;

/**
 * Get admin JWT token (with caching)
 */
async function getAdminToken(): Promise<string> {
    const now = Date.now();

    // Return cached token if still valid (with 5 min buffer)
    if (cachedJwtToken && cachedJwtExpiry > now + 5 * 60 * 1000) {
        return cachedJwtToken;
    }

    const apiUrl = process.env.SIYUAN_SHARE_API_URL;
    const username = process.env.SIYUAN_SHARE_ADMIN_USERNAME;
    const password = process.env.SIYUAN_SHARE_ADMIN_PASSWORD;

    if (!apiUrl || !username || !password) {
        throw new Error('Siyuan-Share credentials not configured');
    }

    const response = await fetch(`${apiUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });

    const result: LoginResponse = await response.json();

    if (result.code !== 0 || !result.data?.token) {
        throw new Error(`Siyuan-Share login failed: ${result.msg || 'Unknown error'}`);
    }

    cachedJwtToken = result.data.token;
    // JWT expires in 24 hours, cache for 23 hours
    cachedJwtExpiry = now + 23 * 60 * 60 * 1000;

    return cachedJwtToken;
}

/**
 * Create a token for user by their LinuxDO ID
 */
async function createTokenByLinuxDoId(linuxDoId: string, tokenName: string): Promise<string> {
    const apiUrl = process.env.SIYUAN_SHARE_API_URL;
    const token = await getAdminToken();

    const response = await fetch(`${apiUrl}/api/admin/tokens/by-linuxdo/${linuxDoId}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ name: tokenName })
    });

    const result: CreateTokenResponse = await response.json();

    // code 2 = user not found
    if (result.code === 2 || response.status === 404) {
        throw new SiyuanShareUserNotFoundError(linuxDoId);
    }

    if (result.code !== 0 || !result.data?.token) {
        throw new Error(`Siyuan-Share create token failed: ${result.msg || 'Unknown error'}`);
    }

    return result.data.token;
}

/**
 * Generate siyuan-share API tokens for an order
 *
 * Requires the user to already exist in siyuan-share (via LinuxDO OAuth login).
 * If user not found, throws SiyuanShareUserNotFoundError.
 */
export async function generateSiyuanShareToken(params: {
    orderId: string;
    linuxDoId: string;
    quantity?: number;
}): Promise<string[]> {
    const { orderId, linuxDoId, quantity = 1 } = params;

    if (!linuxDoId) {
        throw new Error('LinuxDO ID is required for siyuan-share token generation');
    }

    const tokens: string[] = [];

    for (let i = 0; i < quantity; i++) {
        const suffix = quantity > 1 ? ` #${i + 1}` : '';
        const tokenName = `LDC Shop - Order ${orderId}${suffix}`;

        const apiToken = await createTokenByLinuxDoId(linuxDoId, tokenName);
        tokens.push(apiToken);
    }

    return tokens;
}

/**
 * Check if siyuan-share is configured
 */
export function isSiyuanShareConfigured(): boolean {
    const url = process.env.SIYUAN_SHARE_API_URL;
    const username = process.env.SIYUAN_SHARE_ADMIN_USERNAME;
    const password = process.env.SIYUAN_SHARE_ADMIN_PASSWORD;

    console.log(`[Siyuan-Share] Config check - URL: ${url ? 'set' : 'MISSING'}, Username: ${username ? 'set' : 'MISSING'}, Password: ${password ? 'set' : 'MISSING'}`);

    return !!(url && username && password);
}
