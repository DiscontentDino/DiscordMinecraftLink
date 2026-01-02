import type { Context } from 'hono';
import { z } from 'zod';
import { createVerificationFlowRPC } from './rpc/createVerificationFlow';
import { getDiscordOAuthLinkRPC } from './rpc/getDiscordOAuthLink';
import { linkDiscordAccountRPC } from './rpc/linkDiscordAccount';
import { verifyConnectionRPC } from './rpc/verifyConnection';
import { AppLogger } from './utils/appLogger';
import { result } from './utils/result';

export type RPCHandlerFn<
    Params extends z.ZodType,
    Result extends z.ZodType,
> = (data: {
    params: z.infer<Params>;
    logger: AppLogger;
    context: Context<{ Bindings: Env }>;
}) => Promise<z.infer<Result>>;

/**
 * A RPC handler interface.
 */
export interface RPCHandler<
    Method extends string,
    Params extends z.ZodType,
    Result extends z.ZodType,
> {
    /**
     * The method name of the RPC handler.
     */
    method: Method;
    /**
     * The parameters schema of the RPC handler.
     */
    paramsSchema: Params;
    /**
     * The result schema of the RPC handler.
     */
    resultSchema: Result;
    /**
     * The function that handles the RPC call.
     */
    handler: RPCHandlerFn<Params, Result>;
}

const RPC_HANDLERS: RPCHandler<string, z.ZodType, z.ZodType>[] = [
    createVerificationFlowRPC,
    getDiscordOAuthLinkRPC,
    linkDiscordAccountRPC,
    verifyConnectionRPC,
];

/**
 * A list of registered RPC handlers.
 */
class RPCHandlerRegistry {
    /**
     * The shared singleton instance of the RPCHandlerRegistry.
     */
    private static sharedInstance = new RPCHandlerRegistry();

    /**
     * The map of method names to RPC handlers.
     */
    private handlers: Map<
        string,
        RPCHandler<string, z.ZodType, z.ZodType>
    > | null = null;

    /**
     * A private constructor to prevent external instantiation.
     */
    private constructor() {}

    /**
     * Get the shared singleton instance of the RPCHandlerRegistry.
     * @returns The shared RPCHandlerRegistry instance.
     */
    public static shared(): RPCHandlerRegistry {
        return RPCHandlerRegistry.sharedInstance;
    }

    /**
     * Create RPC handlers map.
     * @returns The map of method names to RPC handlers.
     */
    private createHandlersMap(): Map<
        string,
        RPCHandler<string, z.ZodType, z.ZodType>
    > {
        const handlers = new Map<
            string,
            RPCHandler<string, z.ZodType, z.ZodType>
        >();

        for (const handler of RPC_HANDLERS) {
            handlers.set(handler.method, handler);
        }

        return handlers;
    }

    /**
     * Get the map of registered RPC handlers.
     * @returns The map of method names to RPC handlers.
     */
    public getHandlers(): Map<
        string,
        RPCHandler<string, z.ZodType, z.ZodType>
    > {
        if (this.handlers === null) {
            const handlersMap = this.createHandlersMap();
            this.handlers = handlersMap;
            return handlersMap;
        }

        return this.handlers;
    }
}

/**
 * A standard RPC request structure.
 */
const RPCRequestSchema = z.object({
    id: z.union([z.string(), z.number(), z.null()]).optional(),
    jsonrpc: z.literal('2.0'),
    method: z.string(),
    params: z.unknown().optional(),
});

/**
 * A standard RPC response structure.
 */
const RPCResponseSchema = z.union([
    z.object({
        id: z.union([z.string(), z.number(), z.null()]),
        jsonrpc: z.literal('2.0'),
        result: z.unknown(),
    }),
    z.object({
        error: z.object({
            code: z.number(),
            data: z.unknown().optional(),
            message: z.string(),
        }),
        id: z.union([z.string(), z.number(), z.null()]),
        jsonrpc: z.literal('2.0'),
    }),
]);

/**
 * Standard RPC error codes and messages.
 */
const RPCStandardErrors = {
    internalError: { code: -32603, message: 'Internal error' },
    invalidParams: { code: -32602, message: 'Invalid params' },
    invalidRequest: { code: -32600, message: 'Invalid Request' },
    methodNotFound: { code: -32601, message: 'Method not found' },
    parseError: { code: -32700, message: 'Parse error' },
} as const;

/**
 * Handle RPC requests.
 * @param c The Hono context.
 */
const handleRPC = async (
    c: Context<{ Bindings: Env }>,
): Promise<z.infer<typeof RPCResponseSchema>> => {
    // Generate a unique request ID for tracing
    const requestID = crypto.randomUUID();
    let jsonRPCRequestID: string | number | null = null;

    // Create a logger with the request ID in its trace context
    const logger = AppLogger.root().child(['request', requestID]);

    // Get the connecting client's IP address
    const clientIP = c.req.header('CF-Connecting-IP');
    logger.info(`IP: ${clientIP ?? 'unknown'}`);

    // Parse the request body as JSON
    const reqText = await result.tryCatch(c.req.text());
    if (!reqText.success) {
        logger.warn(`Failed to read request body: ${reqText.error}`);
        return {
            error: RPCStandardErrors.parseError,
            id: jsonRPCRequestID,
            jsonrpc: '2.0',
        };
    }
    const reqJSON = result.tryCatch(() => JSON.parse(reqText.value));
    if (!reqJSON.success) {
        logger.warn(`Failed to parse request JSON: ${reqJSON.error}`);
        return {
            error: RPCStandardErrors.parseError,
            id: jsonRPCRequestID,
            jsonrpc: '2.0',
        };
    }

    // Validate the RPC request structure
    const rpcRequest = RPCRequestSchema.safeParse(reqJSON.value);
    if (!rpcRequest.success) {
        logger.warn(
            `Invalid RPC request structure: ${JSON.stringify(rpcRequest.error.issues)}`,
        );
        return {
            error: RPCStandardErrors.invalidRequest,
            id: jsonRPCRequestID,
            jsonrpc: '2.0',
        };
    }
    jsonRPCRequestID = rpcRequest.data.id ?? null;
    logger.debug(`RPC Request ID: ${jsonRPCRequestID}`);

    // Find the corresponding RPC handler
    const handlers = RPCHandlerRegistry.shared().getHandlers();
    const handler = handlers.get(rpcRequest.data.method);
    if (!handler) {
        logger.warn(`Method not found: ${rpcRequest.data.method}`);
        return {
            error: RPCStandardErrors.methodNotFound,
            id: jsonRPCRequestID,
            jsonrpc: '2.0',
        };
    }
    logger.debug(`Handling RPC method: ${rpcRequest.data.method}`);

    // Validate the RPC parameters
    const paramsParseResult = handler.paramsSchema.safeParse(
        rpcRequest.data.params,
    );
    if (!paramsParseResult.success) {
        logger.warn(
            `Invalid RPC params: ${JSON.stringify(paramsParseResult.error.issues)}`,
        );
        return {
            error: RPCStandardErrors.invalidParams,
            id: jsonRPCRequestID,
            jsonrpc: '2.0',
        };
    }

    // Handle the RPC call
    // We create an error boundary here to catch any unexpected errors even though
    // this should not happen if the handler is implemented correctly.
    const handlerResult = await result.tryCatch(
        handler.handler({
            context: c,
            logger: logger.child([rpcRequest.data.method]),
            params: paramsParseResult.data,
        }),
    );
    if (!handlerResult.success) {
        logger.error(
            `Internal error in method ${rpcRequest.data.method}: ${handlerResult.error}`,
        );
        return {
            error: RPCStandardErrors.internalError,
            id: jsonRPCRequestID,
            jsonrpc: '2.0',
        };
    }

    // Validate the RPC result
    return {
        id: jsonRPCRequestID,
        jsonrpc: '2.0',
        result: handlerResult.value,
    };
};

export const rpcHandler = {
    handleRPC,
};
