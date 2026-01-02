import type { Config } from 'drizzle-kit';

export default {
    dialect: 'sqlite',
    driver: 'd1-http',
    schema: './src/db/schema.ts',
} satisfies Config;
