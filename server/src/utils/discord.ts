import { z } from 'zod';
import type { AppLogger } from './appLogger';
import { type Result, result } from './result';

const DISCORD_BASE_URL = 'https://discord.com';

/**
 * Authentication details for Discord API.
 */
export interface DiscordAppAuthentication {
    type: 'application';
    clientID: string;
    clientSecret: string;
}

/**
 * Authentication details for a Discord User.
 */
export interface DiscordUserAuthentication {
    type: 'user';
    accessToken: string;
}

/**
 * Discord fetch error.
 */
type DiscordFetchError =
    | 'network-error'
    | 'invalid-json'
    | 'retries-exhausted'
    | 'timeout';

/**
 * Fetch a discord endpoint.
 * @param endpoint The discord API endpoint to fetch.
 * @param options Fetch options.
 * @param logger The application logger. No child logger is created here because this is an internal function.
 * @returns A Result containing the response data or an error.
 * @remarks Please do not change the `unknown` type in the response. We should assume that the data is NOT in the correct format until we validate it.
 */
const discordFetchInner = async (
    endpoint: string,
    options: RequestInit,
    logger: AppLogger,
): Promise<
    Result<
        { data: unknown; statusCode: number },
        | { type: 'final'; data: DiscordFetchError }
        | { type: 'retry'; afterMs: number | null }
    >
> => {
    const response = await result.tryCatch(
        fetch(`${DISCORD_BASE_URL}/api${endpoint}`, {
            ...options,
            headers: {
                ...options.headers,
                'User-Agent': 'Mozilla/5.0 (compatible; APIClient/1.0)',
            },
        }),
    );
    if (!response.success) {
        logger.error(`Network error fetching "${endpoint}": ${response.error}`);
        return { error: { afterMs: null, type: 'retry' }, success: false };
    }

    // Handle rate limiting and server errors
    if (response.value.status === 429) {
        const retryAfter = response.value.headers.get('Retry-After');
        if (retryAfter === null)
            return { error: { afterMs: null, type: 'retry' }, success: false };

        const retryAfterNumber = Number.parseFloat(retryAfter);
        if (
            Number.isNaN(retryAfterNumber) ||
            !Number.isFinite(retryAfterNumber) ||
            retryAfterNumber < 0
        ) {
            // Try to parse as a date
            const retryAfterDate = new Date(retryAfter);
            if (!Number.isNaN(retryAfterDate.getTime())) {
                const dateUnixMs = retryAfterDate.getTime();
                return {
                    error: {
                        afterMs: Math.max(0, dateUnixMs - Date.now()),
                        type: 'retry',
                    },
                    success: false,
                };
            }

            logger.error(
                `Invalid Retry-After header value "${retryAfter}" when fetching "${endpoint}".`,
            );
            return { error: { afterMs: null, type: 'retry' }, success: false };
        }

        const retryAfterMs = Math.max(0, retryAfterNumber * 1000);
        logger.warn(
            `Rate limited when fetching "${endpoint}". Retrying after ${retryAfterMs} ms.`,
        );
        return {
            error: { afterMs: retryAfterMs, type: 'retry' },
            success: false,
        };
    }

    // Server errors should be retried
    if (response.value.status >= 500 && response.value.status < 600) {
        logger.error(
            `Server error (status: ${response.value.status}) when fetching "${endpoint}". Retrying...`,
        );
        return { error: { afterMs: null, type: 'retry' }, success: false };
    }

    logger.info(`Received status ${response.value.status} from "${endpoint}".`);

    const json = await result.tryCatch(response.value.json());
    if (!json.success) {
        logger.error(`Invalid JSON response from "${endpoint}": ${json.error}`);
        return {
            error: { data: 'invalid-json', type: 'final' },
            success: false,
        };
    }

    logger.debug(`Successful fetch from "${endpoint}".`);
    return {
        success: true,
        value: { data: json.value, statusCode: response.value.status },
    };
};

/**
 * Fetch a discord endpoint.
 * @param endpoint The discord API endpoint to fetch.
 * @param options Fetch options.
 * @param internalOptions Internal options.
 * @returns A Result containing the response data or an error.
 * @remarks Please do not change the `unknown` type in the response. We should assume that the data is NOT in the correct format until we validate it.
 */
export const discordFetch = async (
    endpoint: string,
    options: RequestInit,
    internalOptions: {
        retries?: number;
        timeoutMs?: number;
        logger: AppLogger;
    },
): Promise<
    Result<{ data: unknown; statusCode: number }, DiscordFetchError>
> => {
    const { retries = 3, timeoutMs = 5000 } = internalOptions;
    const logger = internalOptions.logger.child('discordFetch');

    const startTime = Date.now();
    const maxEndTime = startTime + timeoutMs;
    for (let attempt = 1; attempt <= retries + 1; attempt++) {
        logger.debug(`Fetch attempt ${attempt} for "${endpoint}".`);

        const remaining = maxEndTime - Date.now();
        if (remaining <= 0) {
            logger.error(
                `Timeout of ${timeoutMs} ms exceeded for "${endpoint}".`,
            );
            return { error: 'timeout', success: false };
        }

        let wasAborted = false;
        const controller = new AbortController();
        const timer = setTimeout(() => {
            wasAborted = true;
            controller.abort();
        }, remaining);
        const optionsWithSignal = {
            ...options,
            signal: controller.signal,
        };

        const result = await discordFetchInner(
            endpoint,
            optionsWithSignal,
            logger,
        );

        clearTimeout(timer);
        if (wasAborted) {
            logger.error(
                `Timeout after ${timeoutMs} ms when fetching "${endpoint}".`,
            );
            return { error: 'timeout', success: false };
        }

        if (result.success) return { success: true, value: result.value };
        if (result.error.type === 'final')
            return { error: result.error.data, success: false };

        // Skip the logic if no retry is possible
        if (attempt > retries) break;

        if (result.error.afterMs === null) {
            // Use exponential backoff starting at 500ms
            const EXTRA_BUFFER_MS = 100;
            const JITTER_RANGE = 0.3;
            const JITTER_MIN = 0.85;
            const remainingForBackoff =
                maxEndTime - Date.now() - EXTRA_BUFFER_MS;
            const jitter = Math.random() * JITTER_RANGE + JITTER_MIN;
            const backoffMs = Math.min(
                500 * 2 ** (attempt - 1) * jitter,
                remainingForBackoff,
            );
            if (backoffMs <= 0) break;

            logger.info(
                `Retrying fetch for "${endpoint}" after ${backoffMs} ms.`,
            );
            await new Promise((resolve) => setTimeout(resolve, backoffMs));
            continue;
        }

        // Check if the timeout would be exceeded on the next attempt
        const afterMs = result.error.afterMs;
        if (Date.now() + afterMs >= maxEndTime) {
            logger.error(
                `Fetching after ${afterMs}ms would exceed timeout of ${timeoutMs} ms for "${endpoint}".`,
            );
            return { error: 'timeout', success: false };
        }

        logger.info(`Retrying fetch for "${endpoint}" after ${afterMs} ms.`);
        await new Promise((resolve) => setTimeout(resolve, afterMs));
    }

    logger.error(`Exhausted all retries for "${endpoint}".`);
    return { error: 'retries-exhausted', success: false };
};

/**
 * Convert a object to a URLSearchParams instance.
 * @param obj The object to convert.
 * @returns The URLSearchParams instance.
 */
const objectToURLSearchParams = (
    obj: Record<string, string | number | boolean | null | undefined>,
): URLSearchParams => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(obj)) {
        if (value === null || typeof value === 'undefined') continue;
        params.append(key, String(value));
    }
    return params;
};

/**
 * Parameters for creating a Discord OAuth2 URL.
 */
export interface CreateDiscordOAuth2URLParams {
    redirectUri: string;
    scopes: string[];
    state?: string;
}

/**
 * Create a Discord OAuth2 URL.
 * @param auth Authentication details for Discord API.
 * @param params Parameters for creating the OAuth2 URL.
 * @returns The constructed OAuth2 URL.
 */
export const createDiscordOAuth2URL = (
    auth: DiscordAppAuthentication,
    params: CreateDiscordOAuth2URLParams,
): URL => {
    const urlParams = objectToURLSearchParams({
        client_id: auth.clientID,
        redirect_uri: params.redirectUri,
        response_type: 'code',
        scope: params.scopes.join(' '),
        state: params.state ?? null,
    });

    const oauth2URL = new URL(`${DISCORD_BASE_URL}/oauth2/authorize`);
    oauth2URL.search = urlParams.toString();
    return oauth2URL;
};

/**
 * The schema for Discord OAuth2 token exchange error response.
 */
const DiscordOAuth2TokenErrorSchema = z.object({
    error: z.string(),
    error_description: z.string().optional(),
});

/**
 * The schema for Discord OAuth2 token exchange success response.
 */
const DiscordOAuth2TokenDataSchema = z.object({
    access_token: z.string(),
    expires_in: z.number(),
    refresh_token: z.string(),
    scope: z.string(),
    token_type: z.string(),
});

/**
 * Data returned from Discord OAuth2 token exchange.
 */
export interface DiscordOAuth2TokenData {
    accessToken: string;
    expiresAt: number;
    refreshToken: string;
    scope: string[];
    tokenType: string;
}

/**
 * Errors that can occur during Discord OAuth2 token exchange with authorization code.
 */
export type DiscordCreateOAuth2TokenWithCodeError =
    | DiscordFetchError
    | 'invalid-auth'
    | 'unexpected-response'
    | 'unknown-error'
    | 'invalid-code';

/**
 * Create Discord OAuth2 tokens by exchanging an authorization code.
 * @param auth Authentication details for Discord API.
 * @param params Parameters for token exchange.
 * @returns A Result containing the token data or an error.
 */
const createDiscordOAuth2TokenWithCode = async (
    auth: DiscordAppAuthentication,
    params: {
        code: string;
        redirectUri: string;
    },
    appLogger: AppLogger,
): Promise<
    Result<DiscordOAuth2TokenData, DiscordCreateOAuth2TokenWithCodeError>
> => {
    const logger = appLogger.child('createDiscordOAuth2TokenWithCode');

    const bodyParams = objectToURLSearchParams({
        client_id: auth.clientID,
        client_secret: auth.clientSecret,
        code: params.code,
        grant_type: 'authorization_code',
        redirect_uri: params.redirectUri,
    });
    const response = await discordFetch(
        '/oauth2/token',
        {
            body: bodyParams.toString(),
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            method: 'POST',
        },
        { logger },
    );
    if (!response.success) return { error: response.error, success: false };

    if (response.value.statusCode === 401) {
        logger.warn(`Invalid client credentials provided.`);
        return { error: 'invalid-auth', success: false };
    }

    const discordResponse = z
        .union([DiscordOAuth2TokenDataSchema, DiscordOAuth2TokenErrorSchema])
        .safeParse(response.value.data);
    if (!discordResponse.success) {
        logger.error(
            `Unexpected response schema (status: ${response.value.statusCode})`,
        );
        logger.debug(`Response: ${JSON.stringify(response.value.data)}`);
        return { error: 'unexpected-response', success: false };
    }

    if ('error' in discordResponse.data) {
        if (discordResponse.data.error === 'invalid_grant') {
            logger.warn(`Invalid authorization code provided.`);
            return { error: 'invalid-code', success: false };
        }

        logger.warn(
            `Encountered error "${discordResponse.data.error}": ${discordResponse.data.error_description ?? 'No description'}`,
        );
        return { error: 'unknown-error', success: false };
    }

    const tokenData: DiscordOAuth2TokenData = {
        accessToken: discordResponse.data.access_token,
        expiresAt: Date.now() + (discordResponse.data.expires_in - 30) * 1000,
        refreshToken: discordResponse.data.refresh_token,
        scope: discordResponse.data.scope.split(' '),
        tokenType: discordResponse.data.token_type,
    };

    logger.info(`Successfully exchanged authorization code for tokens.`);
    return { success: true, value: tokenData };
};

/**
 * Errors that can occur during Discord OAuth2 token exchange with refresh token.
 */
export type DiscordCreateOAuth2TokenWithRefreshTokenError =
    | DiscordFetchError
    | 'invalid-auth'
    | 'unexpected-response'
    | 'unknown-error';

/**
 * Refresh Discord OAuth2 tokens using a refresh token.
 * @param auth Authentication details for Discord API.
 * @param params Parameters for token refresh.
 * @returns A Result containing the token data or an error.
 */
const createDiscordOAuth2TokenWithRefreshToken = async (
    auth: DiscordAppAuthentication,
    params: {
        refreshToken: string;
    },
    appLogger: AppLogger,
): Promise<
    Result<
        DiscordOAuth2TokenData,
        DiscordCreateOAuth2TokenWithRefreshTokenError
    >
> => {
    const logger = appLogger.child('createDiscordOAuth2TokenWithRefreshToken');

    const bodyParams = objectToURLSearchParams({
        client_id: auth.clientID,
        client_secret: auth.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: params.refreshToken,
    });
    const response = await discordFetch(
        '/oauth2/token',
        {
            body: bodyParams.toString(),
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            method: 'POST',
        },
        { logger },
    );
    if (!response.success) return { error: response.error, success: false };

    if (response.value.statusCode === 401) {
        logger.warn(`Invalid client credentials provided.`);
        return { error: 'invalid-auth', success: false };
    }

    const discordResponse = z
        .union([DiscordOAuth2TokenDataSchema, DiscordOAuth2TokenErrorSchema])
        .safeParse(response.value.data);
    if (!discordResponse.success) {
        logger.error(
            `Unexpected response schema (status: ${response.value.statusCode})`,
        );
        logger.debug(`Response: ${JSON.stringify(response.value.data)}`);
        return { error: 'unexpected-response', success: false };
    }

    if ('error' in discordResponse.data) {
        if (discordResponse.data.error === 'invalid_grant') {
            logger.warn(`Invalid refresh token provided.`);
            return { error: 'invalid-auth', success: false };
        }

        logger.warn(
            `Encountered error "${discordResponse.data.error}": ${discordResponse.data.error_description ?? 'No description'}`,
        );
        return { error: 'unknown-error', success: false };
    }

    const tokenData: DiscordOAuth2TokenData = {
        accessToken: discordResponse.data.access_token,
        expiresAt: Date.now() + (discordResponse.data.expires_in - 30) * 1000,
        refreshToken: discordResponse.data.refresh_token,
        scope: discordResponse.data.scope.split(' '),
        tokenType: discordResponse.data.token_type,
    };

    logger.info(`Successfully refreshed tokens.`);
    return { success: true, value: tokenData };
};

/**
 * Errors that can occur during Discord OAuth2 token revocation.
 */
export type DiscordRevokeOAuth2TokenError =
    | DiscordFetchError
    | 'invalid-auth'
    | 'unexpected-response';

/**
 * Revoke a Discord OAuth2 token.
 * @param auth Authentication details for Discord API.
 * @param params Parameters for token revocation.
 * @param appLogger The application logger.
 * @returns A Result indicating success or an error.
 */
const revokeDiscordOAuth2Token = async (
    auth: DiscordAppAuthentication,
    params: {
        token: string;
    },
    appLogger: AppLogger,
): Promise<Result<void, DiscordRevokeOAuth2TokenError>> => {
    const logger = appLogger.child('revokeDiscordOAuth2Token');

    const bodyParams = objectToURLSearchParams({
        client_id: auth.clientID,
        client_secret: auth.clientSecret,
        token: params.token,
    });
    const response = await discordFetch(
        '/oauth2/token/revoke',
        {
            body: bodyParams.toString(),
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            method: 'POST',
        },
        { logger },
    );
    if (!response.success) return { error: response.error, success: false };

    if (response.value.statusCode === 401) {
        logger.warn(`Invalid client credentials provided.`);
        return { error: 'invalid-auth', success: false };
    }

    // The body strictly doesn't matter
    if (
        response.value.statusCode !== 200 &&
        response.value.statusCode !== 204
    ) {
        logger.error(
            `Unexpected status code ${response.value.statusCode} when revoking token.`,
        );
        logger.debug(`Response: ${JSON.stringify(response.value.data)}`);
        return { error: 'unexpected-response', success: false };
    }

    logger.info(`Successfully revoked token.`);
    return { success: true, value: undefined };
};

/**
 * The schema for Discord API v8+ error responses.
 *
 * Note: There is an error field, but parsing it seems to be complex without many benefits.
 */
const DiscordAPIErrorResponseSchema = z.object({
    code: z.number(),
    message: z.string(),
});

/**
 * The schema for Discord API v8+ user data.
 */
const DiscordAPIUserDataSchema = z.object({
    id: z.string(),
    username: z.string(),
});

/**
 * Data returned from Discord user data fetch.
 */
export interface DiscordUserData {
    id: string;
    username: string;
}

/**
 * Errors that can occur during fetching Discord user data.
 */
export type DiscordFetchUserDataError =
    | DiscordFetchError
    | 'invalid-auth'
    | 'insufficient-permissions'
    | 'unexpected-response';

/**
 * Fetch Discord user data using an access token.
 * @param auth The user authentication details.
 * @param appLogger The application logger.
 * @returns A Result containing the user data or an error.
 * @requires 'identify' scope.
 * @see https://discord.com/developers/docs/resources/user#get-user
 */
const fetchDiscordUserData = async (
    auth: DiscordUserAuthentication,
    appLogger: AppLogger,
): Promise<Result<DiscordUserData, DiscordFetchUserDataError>> => {
    const logger = appLogger.child('fetchDiscordUserData');

    const response = await discordFetch(
        '/v10/users/@me',
        {
            headers: {
                Authorization: `Bearer ${auth.accessToken}`,
            },
            method: 'GET',
        },
        { logger },
    );
    if (!response.success) return { error: response.error, success: false };

    if (response.value.statusCode === 401) {
        logger.warn(`Invalid or expired access token provided.`);
        return { error: 'invalid-auth', success: false };
    }

    if (response.value.statusCode === 403) {
        logger.warn(`Insufficient permissions to fetch user data.`);
        return { error: 'insufficient-permissions', success: false };
    }

    const discordResponse = z
        .union([DiscordAPIUserDataSchema, DiscordAPIErrorResponseSchema])
        .safeParse(response.value.data);
    if (!discordResponse.success) {
        logger.error(
            `Unexpected response schema (status: ${response.value.statusCode})`,
        );
        logger.debug(`Response: ${JSON.stringify(response.value.data)}`);
        return { error: 'unexpected-response', success: false };
    }

    if ('code' in discordResponse.data) {
        logger.warn(
            `Discord error (${discordResponse.data.code}): ${discordResponse.data.message}`,
        );
        return { error: 'unexpected-response', success: false };
    }

    const userData: DiscordUserData = {
        id: discordResponse.data.id,
        username: discordResponse.data.username,
    };

    logger.info(`Successfully fetched user data for user ID ${userData.id}.`);
    return { success: true, value: userData };
};

/**
 * The schema for Discord API v8+ guild data.
 */
const DiscordAPIGuildDataSchema = z.object({
    id: z.string(),
    name: z.string(),
});

/**
 * Data returned from Discord guild data fetch.
 */
export interface DiscordGuildData {
    id: string;
    name: string;
}

/**
 * Errors that can occur during fetching Discord user guilds.
 */
export type DiscordFetchUserGuildsError =
    | DiscordFetchError
    | 'invalid-auth'
    | 'insufficient-permissions'
    | 'unexpected-response';

/**
 * Fetch Discord user's guilds using an access token.
 * @param auth The user authentication details.
 * @param appLogger The application logger.
 * @returns A Result containing the guild data or an error.
 * @requires 'guilds' scope.
 * @remarks Pagination is NOT required for normal users as they can only be in up to 200 guilds and Discord returns up to 200 guilds per request.
 * @see https://discord.com/developers/docs/resources/user#get-user
 */
const fetchDiscordUserGuildsData = async (
    auth: DiscordUserAuthentication,
    appLogger: AppLogger,
): Promise<Result<DiscordGuildData[], DiscordFetchUserGuildsError>> => {
    const logger = appLogger.child('fetchDiscordUserGuilds');

    const response = await discordFetch(
        '/v10/users/@me/guilds',
        {
            headers: {
                Authorization: `Bearer ${auth.accessToken}`,
            },
            method: 'GET',
        },
        { logger },
    );
    if (!response.success) return { error: response.error, success: false };

    if (response.value.statusCode === 401) {
        logger.warn(`Invalid or expired access token provided.`);
        return { error: 'invalid-auth', success: false };
    }

    if (response.value.statusCode === 403) {
        logger.warn(`Insufficient permissions to fetch user guilds.`);
        return { error: 'insufficient-permissions', success: false };
    }

    const discordResponse = z
        .union([
            z.array(DiscordAPIGuildDataSchema),
            DiscordAPIErrorResponseSchema,
        ])
        .safeParse(response.value.data);
    if (!discordResponse.success) {
        logger.error(
            `Unexpected response schema (status: ${response.value.statusCode}).`,
        );
        logger.debug(`Response: ${JSON.stringify(response.value.data)}`);
        return { error: 'unexpected-response', success: false };
    }

    if ('code' in discordResponse.data) {
        logger.warn(
            `Discord error (${discordResponse.data.code}): ${discordResponse.data.message}`,
        );
        return { error: 'unexpected-response', success: false };
    }

    const guildsData: DiscordGuildData[] = discordResponse.data.map(
        (guild) => ({
            id: guild.id,
            name: guild.name,
        }),
    );

    logger.info(`Successfully fetched ${guildsData.length} guilds for user.`);
    return { success: true, value: guildsData };
};

/**
 * The Discord utility functions.
 */
export const discord = {
    /**
     * Create Discord OAuth2 tokens by exchanging an authorization code.
     * @param auth Authentication details for Discord API.
     * @param params Parameters for token exchange.
     * @param appLogger The application logger.
     * @returns A Result containing the token data or an error.
     */
    createDiscordOAuth2TokenWithCode,
    /**
     * Refresh Discord OAuth2 tokens using a refresh token.
     * @param auth Authentication details for Discord API.
     * @param params Parameters for token refresh.
     * @param appLogger The application logger.
     * @returns A Result containing the token data or an error.
     */
    createDiscordOAuth2TokenWithRefreshToken,
    /**
     * Create a Discord OAuth2 URL.
     * @param auth Authentication details for Discord API.
     * @param params Parameters for creating the OAuth2 URL.
     * @returns The constructed OAuth2 URL.
     */
    createDiscordOAuth2URL,
    /**
     * Fetch Discord user data using an access token.
     * @param auth The user authentication details.
     * @param appLogger The application logger.
     * @returns A Result containing the user data or an error.
     * @requires 'identify' scope.
     * @see https://discord.com/developers/docs/resources/user#get-user
     */
    fetchDiscordUserData,
    /**
     * Fetch Discord user's guilds using an access token.
     * @param auth The user authentication details.
     * @param appLogger The application logger.
     * @returns A Result containing the guild data or an error.
     * @requires 'guilds' scope.
     * @remarks Pagination is NOT required for normal users as they can only be in up to 200 guilds and Discord returns up to 200 guilds per request.
     * @see https://discord.com/developers/docs/resources/user#get-user
     */
    fetchDiscordUserGuildsData,
    /**
     * Revoke a Discord OAuth2 token.
     * @param auth Authentication details for Discord API.
     * @param params Parameters for token revocation.
     * @param appLogger The application logger.
     * @returns A Result indicating success or an error.
     */
    revokeDiscordOAuth2Token,
} as const;
