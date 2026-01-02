# Server

This directory contains the Cloudflare Worker backend for the Minecraft-Discord verification system. It handles OAuth2 authentication with Discord, manages verification flows, and interacts with the D1 database.

## Technologies Used

- **Cloudflare Workers**: Serverless platform to run the backend code.
- **D1 Database**: Cloudflare's serverless SQL database for storing verification data.
- **Drizzle ORM**: Type-safe ORM for database interactions.
- **Zod**: Schema validation library for TypeScript and JavaScript.
- **Hono**: Lightweight web framework for Cloudflare Workers.
- **Tailwind CSS**: Utility-first CSS framework for styling the web interface.
- **JSON RPC**: Protocol for remote procedure calls.
- **Biome**: Code formatter and linter for maintaining code quality.

## Setup Instructions

### Environment Setup

1. Ensure you have [Node.js](https://nodejs.org/) and [pnpm](https://pnpm.io/) installed on your machine.
2. Clone this repository to your local machine.
   ```bash
   git clone https://github.com/DiscontentDino/DiscordMinecraftLink.git
   ```
3. Navigate to the `server/` directory.
   ```bash
   cd DiscordMinecraftLink/server
   ```
4. Install the required dependencies using pnpm.
   ```bash
   pnpm install
   ```

### Running Locally

Migrate the database locally (you will only need to do this once as long as the schema does not change):
```bash
pnpm migrate:dev
```

Start the development server:
```bash
pnpm dev
```

The server should now be running at `http://localhost:8787`.
