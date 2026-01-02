import { and, eq, gt } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { verificationFlows } from '../db/schema';
import type { RPCHandler, RPCHandlerFn } from '../rpcHandler';
import { result } from '../utils/result';
import { sharedSecret } from '../utils/sharedSecret';

/**
 * The request schema for createVerificationFlow RPC.
 */
const paramsSchema = z.object({
    minecraftUUID: z.uuid(),
    sharedSecret: z.string(),
});

/**
 * The response schema for createVerificationFlow RPC.
 */
const resultSchema = result.Result({
    err: z.enum([
        'InvalidSharedSecret',
        'DatabaseError',
        'CodeGenerationFailed',
    ]),
    ok: z.object({
        expiresAt: z.iso.datetime(),
        linkingCode: z.string(),
    }),
});

/**
 * The duration (in milliseconds) before the verification flow expires.
 */
const EXPIRY_DURATION_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Maximum number of attempts to generate a unique linking code.
 */
const MAX_CODE_GENERATION_ATTEMPTS = 5;

/**
 * A helper function to generate a random linking code using cryptographically secure randomness.
 * @returns A random alphanumeric linking code.
 */
const generateLinkingCode = (): string => {
    const LENGTH = 8;
    const CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

    const charsLength = CHARS.length;
    const maxValid = 256 - (256 % charsLength);

    let code = '';
    const array = new Uint8Array(LENGTH * 2);
    crypto.getRandomValues(array);

    let arrayIndex = 0;
    while (code.length < LENGTH) {
        if (arrayIndex >= array.length) {
            // Need more random bytes
            crypto.getRandomValues(array);
            arrayIndex = 0;
        }

        const byte = array[arrayIndex++];
        // Only use values that don't cause bias
        if (byte < maxValid) {
            code += CHARS[byte % charsLength];
        }
    }

    return code;
};

/**
 * RPC handler to create a verification flow.
 * @param param0 The RPC handler parameters.
 * @returns The linking code and expiration time.
 */
const handler: RPCHandlerFn<typeof paramsSchema, typeof resultSchema> = async ({
    params,
    logger,
}) => {
    if (!sharedSecret.compare(params.sharedSecret)) {
        logger.warn('Invalid shared secret provided.');
        return { error: 'InvalidSharedSecret', success: false };
    }

    const now = Date.now();
    const expiresAt = now + EXPIRY_DURATION_MS;

    // Check for an existing valid flow for this Minecraft UUID
    const existingFlow = await result.tryCatch(
        db
            .select()
            .from(verificationFlows)
            .where(
                and(
                    eq(verificationFlows.minecraftUUID, params.minecraftUUID),
                    gt(verificationFlows.expiresAt, now),
                ),
            )
            .get(),
    );
    if (!existingFlow.success) {
        logger.error(`Existing flow query failed: ${existingFlow.error}`);
        return { error: 'DatabaseError', success: false };
    }
    if (existingFlow.success && existingFlow.value) {
        const flow = existingFlow.value;
        logger.info(`Reusing existing: ${flow.id}`);
        const update = await result.tryCatch(
            db
                .update(verificationFlows)
                .set({ expiresAt })
                .where(eq(verificationFlows.id, flow.id)),
        );
        if (!update.success) {
            logger.error(`Failed to update existing expiry: ${update.error}`);
            return { error: 'DatabaseError', success: false };
        }
        return {
            success: true,
            value: {
                expiresAt: new Date(expiresAt).toISOString(),
                linkingCode: flow.linkingCode,
            },
        };
    }

    // Delete any expired flow for this UUID before creating a new one
    const deletion = await result.tryCatch(
        db
            .delete(verificationFlows)
            .where(eq(verificationFlows.minecraftUUID, params.minecraftUUID)),
    );
    if (!deletion.success) {
        logger.error(`Failed to delete existing: ${deletion.error}`);
        return {
            error: 'DatabaseError',
            success: false,
        };
    }

    for (let attempt = 0; attempt < MAX_CODE_GENERATION_ATTEMPTS; attempt++) {
        const linkingCode = generateLinkingCode();

        const existingCode = await result.tryCatch(
            db
                .select()
                .from(verificationFlows)
                .where(eq(verificationFlows.linkingCode, linkingCode))
                .get(),
        );
        if (!existingCode.success) {
            logger.error(
                `Linking code uniqueness check failed: ${existingCode.error}`,
            );
            return { error: 'DatabaseError', success: false };
        }

        const codeEntry = existingCode.value;
        if (codeEntry) {
            if (codeEntry.expiresAt > now) {
                logger.info(
                    `Linking code collision on attempt ${attempt + 1}, retrying`,
                );
                continue;
            }

            // Delete the expired colliding code
            const deletion = await result.tryCatch(
                db
                    .delete(verificationFlows)
                    .where(eq(verificationFlows.id, codeEntry.id)),
            );
            if (!deletion.success) {
                logger.error(
                    `Failed to delete expired colliding code: ${deletion.error}`,
                );
                return { error: 'DatabaseError', success: false };
            }
        }

        const insertion = await result.tryCatch(
            db.insert(verificationFlows).values({
                createdAt: now,
                expiresAt,
                linkingCode,
                minecraftUUID: params.minecraftUUID,
            }),
        );
        if (!insertion.success) {
            logger.error(`Failed to insert new flow: ${insertion.error}`);
            return { error: 'DatabaseError', success: false };
        }

        logger.info(
            `Created flow "${linkingCode}" for UUID: ${params.minecraftUUID}`,
        );

        return {
            success: true,
            value: {
                expiresAt: new Date(expiresAt).toISOString(),
                linkingCode,
            },
        };
    }

    logger.error('Failed to generate unique linking code after max attempts');
    return { error: 'CodeGenerationFailed', success: false };
};

export const createVerificationFlowRPC = {
    handler,
    method: 'createVerificationFlow',
    paramsSchema,
    resultSchema,
} as const satisfies RPCHandler<string, z.ZodType, z.ZodType>;
