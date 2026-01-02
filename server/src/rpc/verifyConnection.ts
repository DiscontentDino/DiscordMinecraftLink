import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { connections, discordUsers, minecraftUsers } from '../db/schema';
import type { RPCHandler, RPCHandlerFn } from '../rpcHandler';
import { discord } from '../utils/discord';
import { result } from '../utils/result';
import { sharedSecret } from '../utils/sharedSecret';

/**
 * The request schema for verifyConnection RPC.
 */
const paramsSchema = z.object({
    minecraftUUID: z.uuid(),
    sharedSecret: z.string(),
});

/**
 * The response schema for verifyConnection RPC.
 */
const resultSchema = result.Result({
    err: z.enum([
        'InvalidSharedSecret',
        'NotLinked',
        'InvalidAuth',
        'AccessDenied',
        'DiscordError',
        'DatabaseError',
    ]),
    ok: z.null(),
});

/**
 * RPC handler to verify a linked Discord user is still in the target guild.
 * @param param0 The RPC handler parameters.
 * @returns Null on success.
 */
const handler: RPCHandlerFn<typeof paramsSchema, typeof resultSchema> = async ({
    params,
    logger,
    context,
}) => {
    if (!sharedSecret.compare(params.sharedSecret)) {
        logger.warn('Invalid shared secret provided.');
        return { error: 'InvalidSharedSecret', success: false };
    }

    // Fetch Minecraft user
    const minecraftUserResult = await result.tryCatch(
        db
            .select()
            .from(minecraftUsers)
            .where(eq(minecraftUsers.minecraftUUID, params.minecraftUUID))
            .get(),
    );
    if (!minecraftUserResult.success) {
        logger.error(
            `Database error fetching Minecraft user: ${minecraftUserResult.error}`,
        );
        return { error: 'DatabaseError', success: false };
    }
    const minecraftUser = minecraftUserResult.value;
    if (!minecraftUser) {
        logger.warn(
            `No Minecraft user found for UUID ${params.minecraftUUID}.`,
        );
        return { error: 'NotLinked', success: false };
    }

    // Fetch connection
    const connectionResult = await result.tryCatch(
        db
            .select()
            .from(connections)
            .where(eq(connections.minecraftUserID, minecraftUser.id))
            .get(),
    );
    if (!connectionResult.success) {
        logger.error(
            `Database error fetching connection: ${connectionResult.error}`,
        );
        return { error: 'DatabaseError', success: false };
    }
    const connection = connectionResult.value;
    if (!connection) {
        logger.warn(
            `No connection found for Minecraft UUID ${params.minecraftUUID}.`,
        );
        return { error: 'NotLinked', success: false };
    }

    // Fetch Discord user
    const discordUserResult = await result.tryCatch(
        db
            .select()
            .from(discordUsers)
            .where(eq(discordUsers.id, connection.discordUserID))
            .get(),
    );
    if (!discordUserResult.success) {
        logger.error(
            `Database error fetching Discord user: ${discordUserResult.error}`,
        );
        return { error: 'DatabaseError', success: false };
    }
    const discordUser = discordUserResult.value;
    if (!discordUser) {
        logger.error(`Missing Discord user for connection ${connection.id}.`);
        return { error: 'DatabaseError', success: false };
    }
    if (!discordUser.discordRefreshToken) {
        logger.warn(
            `Discord user ${discordUser.discordID} has no refresh token stored.`,
        );
        return { error: 'InvalidAuth', success: false };
    }

    // Refresh tokens to obtain a fresh access token
    const tokenResult = await discord.createDiscordOAuth2TokenWithRefreshToken(
        {
            clientID: context.env.DISCORD_CLIENT_ID,
            clientSecret: context.env.DISCORD_CLIENT_SECRET,
            type: 'application',
        },
        { refreshToken: discordUser.discordRefreshToken },
        logger,
    );
    if (!tokenResult.success) {
        if (tokenResult.error === 'invalid-auth') {
            logger.warn(
                `Invalid refresh token for Discord user ${discordUser.discordID}.`,
            );
            return { error: 'InvalidAuth', success: false };
        }

        logger.error(`Discord token refresh failed: ${tokenResult.error}`);
        return { error: 'DiscordError', success: false };
    }

    // Persist the new refresh token for future checks
    const refreshUpdate = await result.tryCatch(
        db
            .update(discordUsers)
            .set({ discordRefreshToken: tokenResult.value.refreshToken })
            .where(eq(discordUsers.id, discordUser.id)),
    );
    if (!refreshUpdate.success) {
        logger.error(`Failed to update refresh token: ${refreshUpdate.error}`);
        return { error: 'DatabaseError', success: false };
    }

    // Verify guild membership using the new access token
    const guildsResult = await discord.fetchDiscordUserGuildsData(
        { accessToken: tokenResult.value.accessToken, type: 'user' },
        logger,
    );
    if (!guildsResult.success) {
        if (guildsResult.error === 'invalid-auth') {
            logger.warn(
                `Access token rejected when checking guilds for ${discordUser.discordID}.`,
            );
            return { error: 'InvalidAuth', success: false };
        }

        logger.error(`Failed to fetch guilds: ${guildsResult.error}`);
        return { error: 'DiscordError', success: false };
    }

    const isMember = guildsResult.value.some(
        (guild) => guild.id === context.env.DISCORD_GUILD_ID,
    );
    if (!isMember) {
        logger.warn(
            `Discord user ${discordUser.discordID} is no longer in the guild.`,
        );

        // Remove the connection since the user is no longer in the guild
        const deleteResult = await result.tryCatch(
            db.delete(connections).where(eq(connections.id, connection.id)),
        );
        if (!deleteResult.success) {
            logger.error(
                `Failed to delete connection for user removal: ${deleteResult.error}`,
            );
            return { error: 'DatabaseError', success: false };
        }
        return { error: 'AccessDenied', success: false };
    }

    logger.info(
        `Verified guild membership for Discord user ${discordUser.discordID} linked to Minecraft UUID ${params.minecraftUUID}.`,
    );

    return { success: true, value: null };
};

export const verifyConnectionRPC = {
    handler,
    method: 'verifyConnection',
    paramsSchema,
    resultSchema,
} as const satisfies RPCHandler<string, z.ZodType, z.ZodType>;
