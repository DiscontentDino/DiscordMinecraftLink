import { and, eq, gt } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import {
    connections,
    discordUsers,
    minecraftUsers,
    verificationFlows,
} from '../db/schema';
import type { RPCHandler, RPCHandlerFn } from '../rpcHandler';
import { discord } from '../utils/discord';
import { result } from '../utils/result';

/**
 * The request schema for linkDiscordAccount RPC.
 */
const paramsSchema = z.object({
    code: z.string(),
    state: z.string(),
});

/**
 * The response schema for linkDiscordAccount RPC.
 */
const resultSchema = result.Result({
    err: z.enum([
        'InvalidState',
        'InvalidLinkingCode',
        'InvalidCode',
        'DiscordError',
        'DatabaseError',
        'AccessDenied',
    ]),
    ok: z.object({
        discordUsername: z.string(),
    }),
});

/**
 * The OAuth state payload schema.
 */
const oauthStateSchema = z.object({
    linkingCode: z.string(),
    timestamp: z.coerce.number(),
});

/**
 * Decode the OAuth state from a URLSearchParams string.
 * @param state The URL-encoded state string.
 * @returns The parsed state object or null if invalid.
 */
const decodeOAuthState = (
    state: string,
): z.infer<typeof oauthStateSchema> | null => {
    try {
        const params = new URLSearchParams(state);
        const parsed = oauthStateSchema.safeParse({
            linkingCode: params.get('linkingCode'),
            timestamp: params.get('timestamp'),
        });
        if (!parsed.success) return null;
        return parsed.data;
    } catch {
        return null;
    }
};

/**
 * RPC handler to link a Discord account to a Minecraft account.
 * @param param0 The RPC handler parameters.
 * @returns The linked Discord and Minecraft account information.
 */
const handler: RPCHandlerFn<typeof paramsSchema, typeof resultSchema> = async ({
    params,
    logger,
    context,
}) => {
    const now = Date.now();

    const state = decodeOAuthState(params.state);
    if (!state) {
        logger.warn('Invalid OAuth state provided.');
        return { error: 'InvalidState', success: false };
    }

    // Verify the linking code exists and is not expired
    const flowResult = await result.tryCatch(
        db
            .select()
            .from(verificationFlows)
            .where(
                and(
                    eq(verificationFlows.linkingCode, state.linkingCode),
                    gt(verificationFlows.expiresAt, now),
                ),
            )
            .get(),
    );
    if (!flowResult.success) {
        logger.error(
            `Database error fetching verification flow: ${flowResult.error}`,
        );
        return { error: 'DatabaseError', success: false };
    }

    const flow = flowResult.value;
    if (!flow) {
        logger.warn(`Invalid linking code: ${state.linkingCode}`);
        return { error: 'InvalidLinkingCode', success: false };
    }

    // Exchange the authorization code for tokens
    const redirectUri = `${context.env.APP_URL}/oauth2/discord/`;
    const tokenResult = await discord.createDiscordOAuth2TokenWithCode(
        {
            clientID: context.env.DISCORD_CLIENT_ID,
            clientSecret: context.env.DISCORD_CLIENT_SECRET,
            type: 'application',
        },
        {
            code: params.code,
            redirectUri,
        },
        logger,
    );

    if (!tokenResult.success) {
        if (tokenResult.error === 'invalid-code') {
            logger.warn('Invalid authorization code provided.');
            return { error: 'InvalidCode', success: false };
        }
        logger.error(`Discord token exchange failed: ${tokenResult.error}`);
        return { error: 'DiscordError', success: false };
    }

    // Fetch the Discord user data
    const userResult = await discord.fetchDiscordUserData(
        { accessToken: tokenResult.value.accessToken, type: 'user' },
        logger,
    );
    if (!userResult.success) {
        logger.error(`Failed to fetch Discord user data: ${userResult.error}`);
        return { error: 'DiscordError', success: false };
    }

    const discordUser = userResult.value;
    logger.info(
        `Discord user ${discordUser.id} (${discordUser.username}) authenticated.`,
    );

    // Ensure the user is in the required guild
    const guildMembershipResult = await discord.fetchDiscordUserGuildsData(
        { accessToken: tokenResult.value.accessToken, type: 'user' },
        logger,
    );
    if (!guildMembershipResult.success) {
        logger.error(
            `Failed to fetch Discord user guilds: ${guildMembershipResult.error}`,
        );
        return { error: 'DiscordError', success: false };
    }

    const isMember = guildMembershipResult.value.some(
        (guild) => guild.id === context.env.DISCORD_GUILD_ID,
    );
    if (!isMember) {
        logger.warn(
            `Discord user ${discordUser.id} is not a member of the required guild.`,
        );
        return { error: 'AccessDenied', success: false };
    }

    // Create or update the discord / minecraft user records and the connection
    const batch = await result.tryCatch(
        db.batch([
            db
                .insert(discordUsers)
                .values({
                    createdAt: now,
                    discordID: discordUser.id,
                    discordRefreshToken: tokenResult.value.refreshToken,
                })
                .onConflictDoUpdate({
                    set: {
                        discordRefreshToken: tokenResult.value.refreshToken,
                    },
                    target: discordUsers.discordID,
                })
                .returning(),
            db
                .insert(minecraftUsers)
                .values({
                    createdAt: now,
                    minecraftUUID: flow.minecraftUUID,
                })
                .onConflictDoUpdate({
                    set: {
                        minecraftUUID: flow.minecraftUUID,
                    },
                    target: minecraftUsers.minecraftUUID,
                })
                .returning(),
        ]),
    );
    if (!batch.success) {
        logger.error(`Failed to upsert user records: ${batch.error}`);
        return { error: 'DatabaseError', success: false };
    }
    const discordRecord = batch.value[0][0];
    const minecraftRecord = batch.value[1][0];
    if (!discordRecord || !minecraftRecord) {
        logger.error('Updated / inserted records missing from result.');
        return { error: 'DatabaseError', success: false };
    }

    // Overwrite any existing connection
    const connection = await result.tryCatch(
        db.batch([
            db
                .insert(connections)
                .values({
                    createdAt: now,
                    discordUserID: discordRecord.id,
                    minecraftUserID: minecraftRecord.id,
                })
                .onConflictDoUpdate({
                    set: {
                        createdAt: now,
                        discordUserID: discordRecord.id,
                    },
                    target: connections.minecraftUserID,
                }),
            db
                .delete(verificationFlows)
                .where(eq(verificationFlows.id, flow.id)),
        ]),
    );
    if (!connection.success) {
        logger.error(
            `Failed to create / update connection: ${connection.error}`,
        );
        return { error: 'DatabaseError', success: false };
    }

    logger.info(
        `Linked Discord user ${discordUser.id} to Minecraft UUID ${flow.minecraftUUID}.`,
    );

    return {
        success: true,
        value: {
            discordUsername: `${discordUser.username}`,
        },
    };
};

export const linkDiscordAccountRPC: RPCHandler<
    'linkDiscordAccount',
    typeof paramsSchema,
    typeof resultSchema
> = {
    handler,
    method: 'linkDiscordAccount',
    paramsSchema,
    resultSchema,
};
