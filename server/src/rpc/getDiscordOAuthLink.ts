import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { verificationFlows } from '../db/schema';
import type { RPCHandler, RPCHandlerFn } from '../rpcHandler';
import { result } from '../utils/result';

/**
 * The request schema for getDiscordOAuthLink RPC.
 */
const paramsSchema = z.object({
    linkingCode: z.string(),
});

/**
 * The response schema for getDiscordOAuthLink RPC.
 */
const resultSchema = result.Result({
    err: z.enum(['InvalidLinkingCode', 'DatabaseError']),
    ok: z.object({
        oauthURL: z.string().url(),
    }),
});

/**
 * Discord OAuth2 scopes needed for verification.
 */
const DISCORD_SCOPES = ['identify', 'guilds'];

/**
 * The OAuth state payload schema.
 */
const oauthStateSchema = z.object({
    linkingCode: z.string(),
    timestamp: z.coerce.number(),
});

type OAuthState = z.infer<typeof oauthStateSchema>;

/**
 * Encode the OAuth state as a URLSearchParams string.
 * @param state The state object to encode.
 * @returns A URL-encoded string.
 */
const encodeOAuthState = (state: OAuthState): string => {
    const params = new URLSearchParams({
        linkingCode: state.linkingCode,
        timestamp: state.timestamp.toString(),
    });
    return params.toString();
};

/**
 * RPC handler to generate a Discord OAuth link.
 * @param param0 The RPC handler parameters.
 * @returns The Discord OAuth URL.
 */
const handler: RPCHandlerFn<typeof paramsSchema, typeof resultSchema> = async ({
    params,
    logger,
    context,
}) => {
    const now = Date.now();

    // Verify the linking code exists and is not expired
    const dbResult = await result.tryCatch(
        db
            .select()
            .from(verificationFlows)
            .where(eq(verificationFlows.linkingCode, params.linkingCode))
            .get(),
    );

    if (!dbResult.success) {
        logger.error(
            `Database error fetching verification flow: ${dbResult.error}`,
        );
        return { error: 'DatabaseError', success: false };
    }

    const flow = dbResult.value;

    if (!flow) {
        logger.warn(`Invalid linking code: ${params.linkingCode}`);
        return { error: 'InvalidLinkingCode', success: false };
    }

    if (flow.expiresAt <= now) {
        logger.warn(`Expired linking code: ${params.linkingCode}`);
        return { error: 'InvalidLinkingCode', success: false };
    }

    // Build the OAuth state
    const state: OAuthState = {
        linkingCode: params.linkingCode,
        timestamp: now,
    };
    const encodedState = encodeOAuthState(state);

    // Build the Discord OAuth URL
    const { DISCORD_CLIENT_ID, APP_URL } = context.env;
    const redirectUri = `${APP_URL}/oauth2/discord/`;

    const oauthParams = new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: DISCORD_SCOPES.join(' '),
        state: encodedState,
    });

    logger.info(`Generated link for linking code: ${params.linkingCode}`);
    const oauthURL = `https://discord.com/oauth2/authorize?${oauthParams.toString()}`;

    return { success: true, value: { oauthURL } };
};

export const getDiscordOAuthLinkRPC = {
    handler,
    method: 'getDiscordOAuthLink',
    paramsSchema,
    resultSchema,
} as const satisfies RPCHandler<string, z.ZodType, z.ZodType>;

/**
 * Decode and validate the OAuth state from a URLSearchParams string.
 * @param encodedState The URL-encoded state string.
 * @returns The decoded state object or null if invalid.
 */
export const decodeOAuthState = (encodedState: string): OAuthState | null => {
    try {
        const params = new URLSearchParams(encodedState);
        const parsed = Object.fromEntries(params.entries());
        const result = oauthStateSchema.safeParse(parsed);
        return result.success ? result.data : null;
    } catch {
        return null;
    }
};
