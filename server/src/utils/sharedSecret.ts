import { env } from 'cloudflare:workers';
import crypto from 'node:crypto';

/**
 * Compare the provided shared secret with the expected one.
 * @param providedSecret The shared secret provided by the client.
 * @returns True if the shared secrets match, false otherwise.
 */
const compare = (providedSecret: string): boolean => {
    const expectedSecret = Buffer.from(env.SHARED_SECRET, 'utf-8');
    const providedSecretBuffer = Buffer.from(providedSecret, 'utf-8');

    if (providedSecretBuffer.length !== expectedSecret.length) {
        return false;
    }

    return crypto.timingSafeEqual(providedSecretBuffer, expectedSecret);
};

export const sharedSecret = {
    /**
     * Compare the provided shared secret with the expected one.
     * @param providedSecret The shared secret provided by the client.
     * @returns True if the shared secrets match, false otherwise.
     */
    compare,
};
