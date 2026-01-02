# DiscordMinecraftLink

DiscordMinecraftLink is a Minecraft plugin that allows access to a Minecraft server only to users who have verified their Discord account while being a member of a specific Discord server.

## Project Structure

- `server/`: Contains the Cloudflare Worker code that handles the Discord verification process.
- `plugin/`: Contains the Minecraft plugin code that integrates with the server and communicates with the Cloudflare Worker.

## License

**SPDX:** GPL-2.0-only

DiscordMinecraftLink, a Minecraft plugin for Discord verification.
Copyright (C) 2025 Dcnt

This program is free software; you can redistribute it and/or
modify it under the terms of the GNU General Public License
as published by the Free Software Foundation; only version 2
of the License.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program; if not, see
<https://www.gnu.org/licenses/>.


## Configuration

There are two parts to configuration: the Minecraft plugin configuration and the Cloudflare Worker configuration.

### Shared

1. Generate a shared secret for secure communication between the Minecraft plugin and the Cloudflare Worker.
   ```bash
   openssl rand 64 | base64
   ```

### Cloudflare Worker Configuration

1. Fork this repository to your own GitHub account.
2. Set up a Cloudflare account.
3. Clone your forked repository to your local machine.
4. Navigate to the `server/` directory.
   ```bash
   cd server
   ```
5. Install the required dependencies using pnpm.
   ```bash
   pnpm install
   ```
6. Create a `D1` database in Cloudflare.
   ```bash
   pnpm wrangler d1 create <YOUR_DATABASE_NAME>
   ```
   Make sure to **NOT** add the record to the `wrangler.jsonc` file. Take note of the `database_name` and the `database_id`.
7. Add your database information to the `wrangler.jsonc` file. Use the values you noted in the previous step.
   ```diff
     "d1_databases": [
         {
             "binding": "database",
   -         "database_id": "6c7cce96-2239-4851-bf6e-e75686c4625d",
   -         "database_name": "me-dcnt-mc-verify-d1",
   +         "database_id": "<YOUR_DATABASE_ID>",
   +         "database_name": "<YOUR_DATABASE_NAME>",
             "migrations_dir": "drizzle"
         }
     ],
   ```
8. Replace the domain information in the `wrangler.jsonc` file. Make sure to replace `<YOUR_CUSTOM_DOMAIN>` with your actual custom domain.
   ```diff
     "routes": [
         {
             "custom_domain": true,
   -         "pattern": "verify.mc.dcnt.me"
   +         "pattern": "<YOUR_CUSTOM_DOMAIN>"
         }
     ],
     "vars": {
   -     "APP_URL": "https://verify.mc.dcnt.me",
   +     "APP_URL": "https://<YOUR_CUSTOM_DOMAIN>",
         "NODE_ENV": "production"
     },
   ```
9. Change the `name` field in the `wrangler.jsonc` file to a unique name for your Cloudflare Worker.
   ```diff
   - "name": "me-dcnt-mc-verify",
   + "name": "<YOUR_UNIQUE_WORKER_NAME>",
   ```
10. Update the `package.json` to use your database name.
    ```diff
      "scripts": {
          "biome:check": "biome check",
          "biome:fix": "biome check --fix",
          "cf-typegen": "wrangler types",
          "deploy": "wrangler deploy --minify",
          "dev": "wrangler dev",
          "drizzle:generate": "drizzle-kit generate",
   -      "migrate": "wrangler d1 migrations apply --remote me-dcnt-mc-verify-d1",
   -      "migrate:dev": "wrangler d1 migrations apply --local me-dcnt-mc-verify-d1"
   +      "migrate": "wrangler d1 migrations apply --remote <YOUR_DATABASE_NAME>",
   +      "migrate:dev": "wrangler d1 migrations apply --local <YOUR_DATABASE_NAME>"
      },
    ```
11. Create a Discord Application.
    1. Navigate to the "OAuth2" section
    2. Keep note of the `Client ID` and `Client Secret` (regenerate if necessary).
    3. Under "Redirects", add the following redirect URL:
       ```
       https://<YOUR_CUSTOM_DOMAIN>/discord/callback/
       ```
12. Run `pnpm wrangler deploy` to deploy the Cloudflare Worker.
13. Add your secret and Discord application credentials to the Cloudflare Worker environment variables.
    ```bash
    pnpm wrangler secret put SHARED_SECRET
    pnpm wrangler secret put DISCORD_CLIENT_ID
    pnpm wrangler secret put DISCORD_CLIENT_SECRET
    pnpm wrangler secret put DISCORD_GUILD_ID
    ```
14. Run the database migrations to set up the required tables.
    ```bash
    pnpm migrate
    ```
15. Your Cloudflare Worker should now be set up and running!

### Minecraft Plugin Configuration

1. Download the latest release of the Minecraft plugin from the Releases section.
2. Place the downloaded `.jar` file into your Minecraft server's `plugins/` directory
3. Start your Minecraft server to generate the default configuration file.
4. Open the `plugins/DiscordMinecraftLink/config.yml` file and update the following fields:
   - `workerUrl`: Set this to the URL of your deployed Cloudflare Worker (e.g., `https://<YOUR_CUSTOM_DOMAIN>`).
   - `sharedSecret`: Set this to the shared secret you generated earlier.
5. Save the configuration file and restart your Minecraft server.
