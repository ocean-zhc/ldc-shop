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

interface CreateUserResponse {
    code: number;
    msg: string;
    data?: {
        id: string;
        username: string;
        email: string;
    };
}

interface CreateTokenResponse {
    code: number;
    msg: string;
    data?: {
        id: string;
        name: string;
        token: string;
        createdAt: string;
    };
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
 * Create a new user in siyuan-share
 */
async function createUser(params: {
    username: string;
    email: string;
    expirationDays?: number;
}): Promise<{ id: string; username: string; email: string }> {
    const apiUrl = process.env.SIYUAN_SHARE_API_URL;
    const token = await getAdminToken();

    const response = await fetch(`${apiUrl}/api/admin/users`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
            username: params.username,
            email: params.email,
            expirationDays: params.expirationDays ?? null
        })
    });

    const result: CreateUserResponse = await response.json();

    if (result.code !== 0 || !result.data) {
        throw new Error(`Siyuan-Share create user failed: ${result.msg || 'Unknown error'}`);
    }

    return result.data;
}

/**
 * Create a token for an existing user
 */
async function createTokenForUser(userId: string, tokenName: string): Promise<string> {
    const apiUrl = process.env.SIYUAN_SHARE_API_URL;
    const token = await getAdminToken();

    const response = await fetch(`${apiUrl}/api/admin/users/${userId}/tokens`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ name: tokenName })
    });

    const result: CreateTokenResponse = await response.json();

    if (result.code !== 0 || !result.data?.token) {
        throw new Error(`Siyuan-Share create token failed: ${result.msg || 'Unknown error'}`);
    }

    return result.data.token;
}

/**
 * Generate a siyuan-share API token for an order
 *
 * This creates a new user (if needed) and generates a token for them.
 * The token is returned as the fulfillment content.
 */
export async function generateSiyuanShareToken(params: {
    orderId: string;
    email?: string | null;
    username?: string | null;
    quantity?: number;
}): Promise<string[]> {
    const { orderId, quantity = 1 } = params;

    // Generate unique identifier for this order
    const uniqueId = orderId.replace(/[^a-zA-Z0-9]/g, '').slice(-12);
    const timestamp = Date.now().toString(36);

    const tokens: string[] = [];

    for (let i = 0; i < quantity; i++) {
        const suffix = quantity > 1 ? `-${i + 1}` : '';
        // Always use unique email based on order ID to avoid duplicates
        const userEmail = `order-${uniqueId}${suffix}-${timestamp}@ldc-shop.local`;
        const userName = `ldc-${uniqueId}${suffix}-${timestamp}`;

        try {
            // Step 1: Create user
            const user = await createUser({
                username: userName,
                email: userEmail,
                expirationDays: 30
            });

            // Step 2: Create token for user
            const tokenName = `LDC Order ${orderId}${suffix}`;
            const apiToken = await createTokenForUser(user.id, tokenName);

            tokens.push(apiToken);
        } catch (error: any) {
            console.error(`[Siyuan-Share] Failed to generate token for order ${orderId}:`, error.message);
            throw error;
        }
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
