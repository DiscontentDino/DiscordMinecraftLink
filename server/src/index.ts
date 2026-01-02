import { Hono } from 'hono';
import { rpcHandler } from './rpcHandler';

const app = new Hono<{ Bindings: Env }>();

app.post('/api/rpc', async (c) => {
    const response = await rpcHandler.handleRPC(c);
    return c.json(response);
});

export default app;
