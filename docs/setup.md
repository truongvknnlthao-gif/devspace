# Setup Guide

This guide is for users who want ChatGPT or another MCP host to work in local
projects through DevSpace.

## Requirements

- Node `>=20.12 <27`; Node 22 LTS is recommended
- npm
- Git
- Bash, including Git Bash or WSL on Windows
- a public HTTPS URL that forwards to the local DevSpace server

DevSpace does not create the public tunnel for you. Use Cloudflare Tunnel,
ngrok, Pinggy, Tailscale Funnel, or your own HTTPS reverse proxy.

## Install And Configure

Run:

```bash
npx @waishnav/devspace init
```

The setup flow asks one question at a time.

### Project Roots

Choose the folders ChatGPT is allowed to open through DevSpace. Keep this
narrow.

Examples:

```text
~/personal,~/work
```

```text
/Users/alice/dev,/Users/alice/work
```

```text
C:\Users\alice\dev,C:\Users\alice\work
```

### Local Port

The default is `7676`.

The local MCP URL is:

```text
http://127.0.0.1:7676/mcp
```

### Public Base URL

Start your tunnel or reverse proxy before entering this value. Point the tunnel
at:

```text
http://127.0.0.1:7676
```

Enter the public origin without `/mcp`:

```text
https://your-tunnel-host.example.com
```

Configure the MCP client with the full MCP endpoint:

```text
https://your-tunnel-host.example.com/mcp
```

## Start The Server

Run:

```bash
npx @waishnav/devspace serve
```

If your tunnel URL changes for one run, override it without rewriting config:

```bash
DEVSPACE_PUBLIC_BASE_URL="https://new-tunnel.example.com" npx @waishnav/devspace serve
```

For a stable public URL, persist it:

```bash
npx @waishnav/devspace config set publicBaseUrl https://devspace.example.com
npx @waishnav/devspace serve
```

## Connect ChatGPT In Developer Mode

Use ChatGPT's personal developer-app flow for a self-hosted DevSpace server:

1. Open **Settings > Security and login** and enable **Developer mode**.
2. Open the **Plugins** directory.
3. Select the **Personal** tab. The **Public** tab only shows the public
   directory and does not expose the personal app creation flow.
4. Select **Create app**.
5. Enter a name and description, use the full public MCP endpoint such as
   `https://your-tunnel-host.example.com/mcp`, and select **OAuth**.
6. Review the developer-app warning, confirm it only for a server you trust,
   and create the app.
7. Select **Connect** or **Sign in**. On the DevSpace authorization page, enter
   the Owner password and approve the client.
8. Return to the plugin details, confirm it says **Connected**, and select
   **Refresh**. The Actions section should list DevSpace tools such as
   `open_workspace`, `read`, `edit`, and `bash`.

Keep the Owner password out of the app name, description, URL, screenshots, and
logs. Enter it only on the DevSpace authorization page for a client you
intentionally want to trust.

ChatGPT and DevSpace use separate version identifiers:

- ChatGPT assigns a generated app ID beginning with `plugin_asdk_app_` and
  development revision metadata such as `dev mode` and `dev-0`.
- DevSpace reports its server version and source commit from `/healthz`, for
  example `1.2.0` plus a Git commit.

Deleting and recreating the personal app creates a new ChatGPT app identity and
a new development revision sequence. It does not change or redeploy the
DevSpace server, so the ChatGPT development revision is not expected to match
the DevSpace package version.

## Approve The Client

When ChatGPT, Claude, or another MCP client connects, DevSpace shows an Owner
password approval page. Enter the Owner password printed during setup.

The default config files are:

```text
~/.devspace/config.json
~/.devspace/auth.json
```

Keep `auth.json` private.

## Check Your Setup

Run:

```bash
npx @waishnav/devspace doctor
```

The doctor command reports the resolved config, Node version, Node ABI, platform,
Git, Bash, public URL, allowed hosts, and SQLite native dependency status.

## Running From A Local Checkout

If you are developing DevSpace itself instead of using the published package:

```bash
npm install --include=dev
npm run dev
```

The same setup rules apply.
