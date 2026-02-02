/**
 * siyuan-share API 客户端
 * 用于动态生成 Token 的商品发货
 */

const SIYUAN_SHARE_API_URL = process.env.SIYUAN_SHARE_API_URL || '';
const SIYUAN_SHARE_ADMIN_USERNAME = process.env.SIYUAN_SHARE_ADMIN_USERNAME || '';
const SIYUAN_SHARE_ADMIN_PASSWORD = process.env.SIYUAN_SHARE_ADMIN_PASSWORD || '';

let cachedJwt: string | null = null;
let jwtExpiresAt: number = 0;

async function getAdminJwt(): Promise<string> {
    // JWT 有效期 24h，提前 1h 刷新
    if (cachedJwt && Date.now() < jwtExpiresAt - 3600000) {
        return cachedJwt;
    }

    if (!SIYUAN_SHARE_API_URL || !SIYUAN_SHARE_ADMIN_USERNAME || !SIYUAN_SHARE_ADMIN_PASSWORD) {
        throw new Error('siyuan-share API credentials not configured');
    }

    const res = await fetch(`${SIYUAN_SHARE_API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            username: SIYUAN_SHARE_ADMIN_USERNAME,
            password: SIYUAN_SHARE_ADMIN_PASSWORD,
        }),
    });

    if (!res.ok) {
        throw new Error(`siyuan-share login failed: ${res.status}`);
    }

    const data = await res.json();
    if (data.code !== 0 || !data.data?.token) {
        throw new Error(`siyuan-share login failed: ${data.msg || 'Unknown error'}`);
    }

    cachedJwt = data.data.token;
    jwtExpiresAt = Date.now() + 23 * 3600 * 1000; // 23h
    return cachedJwt;
}

export interface CreateTokenResult {
    success: boolean;
    token?: string;
    tokenId?: string;
    username?: string;
    error?: string;
    errorCode?: number;
}

/**
 * 根据 LinuxDoID 为用户创建 Token
 * @param linuxDoId LinuxDO 用户 ID
 * @param tokenName Token 名称/备注
 */
export async function createTokenByLinuxDoId(
    linuxDoId: string | number,
    tokenName: string
): Promise<CreateTokenResult> {
    try {
        const jwt = await getAdminJwt();

        const res = await fetch(
            `${SIYUAN_SHARE_API_URL}/api/admin/tokens/by-linuxdo/${linuxDoId}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${jwt}`,
                },
                body: JSON.stringify({ name: tokenName }),
            }
        );

        const data = await res.json();

        if (data.code === 0 && data.data?.token) {
            return {
                success: true,
                token: data.data.token,
                tokenId: data.data.id,
                username: data.data.username,
            };
        }

        // code=2 表示用户不存在
        return {
            success: false,
            error: data.msg || 'Failed to create token',
            errorCode: data.code,
        };
    } catch (err: any) {
        return {
            success: false,
            error: err.message || 'Unknown error',
        };
    }
}

/**
 * 检查 siyuan-share API 是否已配置
 */
export function isSiyuanShareConfigured(): boolean {
    return !!(SIYUAN_SHARE_API_URL && SIYUAN_SHARE_ADMIN_USERNAME && SIYUAN_SHARE_ADMIN_PASSWORD);
}
