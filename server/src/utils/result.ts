import { z } from 'zod';

/**
 * A successful result containing a value of type T.
 * @template T The type of the successful result value.
 */
export interface ResultOk<T> {
    success: true;
    value: T;
}

/**
 * An error result containing a value of type T.
 * @template T The type of the error result value.
 */
export interface ResultErr<T> {
    success: false;
    error: T;
}

/**
 * A union type representing either a successful result or an error result.
 * @template Ok The type of the successful result value.
 * @template Err The type of the error result value.
 */
export type Result<Ok, Err> = ResultOk<Ok> | ResultErr<Err>;

interface TryCatchFunction {
    /**
     * A function that executes a given synchronous function and returns a Result.
     * @template Ok The type of the successful result value.
     * @template Err The type of the error result value.
     */
    <Ok, Err = unknown>(fn: () => Ok): Result<Ok, Err>;
    /**
     * A function that executes a given Promise and returns a Promise of Result.
     * @template Ok The type of the successful result value.
     * @template Err The type of the error result value.
     */
    <Ok, Err = unknown>(promise: Promise<Ok>): Promise<Result<Ok, Err>>;
}

const tryCatch = <Ok, Err = unknown>(
    fnOrPromise: (() => Ok) | Promise<Ok>,
): Result<Ok, Err> | Promise<Result<Ok, Err>> => {
    if (fnOrPromise instanceof Function) {
        try {
            return { success: true, value: fnOrPromise() };
        } catch (error) {
            return { error: error as Err, success: false };
        }
    }

    return (async () => {
        try {
            const value = await fnOrPromise;
            return { success: true, value };
        } catch (error) {
            return { error: error as Err, success: false };
        }
    })();
};

/**
 * A helper function to create a Zod schema for Result types.
 * @param param0 The Ok and Err Zod schemas.
 * @returns A Zod schema representing the Result type.
 */
const Result = <Ok extends z.ZodType, Err extends z.ZodType>({
    ok,
    err,
}: {
    ok: Ok;
    err: Err;
}) =>
    z.discriminatedUnion('success', [
        z.object({
            success: z.literal(true),
            value: ok,
        }),
        z.object({
            error: err,
            success: z.literal(false),
        }),
    ]);

export const result = {
    Result,
    tryCatch: tryCatch as TryCatchFunction,
} as const;
