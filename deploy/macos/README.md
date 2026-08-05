# macOS Service Templates

These templates describe the maintained macOS deployment shape:

- an immutable release under `~/.local/share/devspace-releases/`
- `~/.local/share/devspace-runtime` as the active release symlink
- `~/.local/bin/devspace` as the stable Node 24 wrapper
- one LaunchAgent for DevSpace
- one LaunchAgent for a named Cloudflare Tunnel
- one conservative watchdog LaunchAgent for a disconnected tunnel

Copy the examples outside the repository and replace every `__PLACEHOLDER__`.
Do not commit the rendered files because they contain machine paths and tunnel
identity.

Render `__NODE_24_BINARY__` as the absolute path of the Node 24 executable.
Keep that path fixed in the wrapper and install release dependencies with the
same executable so native modules use the Node 24 ABI.

## Cloudflare Tunnel Provisioning

A named Cloudflare Tunnel deployment has two independent Cloudflare-side and
device-side parts:

1. a proxied DNS route maps the public hostname to the named tunnel;
2. the local `cloudflared` process maintains outbound connections and applies
   the ingress rule that forwards the hostname to `127.0.0.1:7676`.

DNS alone is not enough. If the LaunchAgent or DevSpace server stops, the DNS
record remains but the application is unavailable.

Authenticate and create the locally managed tunnel once:

```bash
cloudflared tunnel login
cloudflared tunnel create <tunnel-name>
```

Render `cloudflared-config.yml.example` outside the repository with the created
tunnel ID, credentials path, and public hostname. Then create the hostname
route:

```bash
cloudflared tunnel route dns <tunnel-name-or-id> <public-hostname>
```

This creates the proxied CNAME that targets the tunnel. Keep the account
certificate, tunnel credentials JSON, rendered configuration, hostname, and
machine paths outside Git.

## Files

- `devspace-wrapper.sh.example`: stable Node 24/runtime entrypoint
- `com.devspace.server.plist.example`: DevSpace LaunchAgent
- `cloudflared-config.yml.example`: named-tunnel ingress
- `com.devspace.cloudflare-tunnel.plist.example`: tunnel LaunchAgent
- `devspace-tunnel-watchdog.sh.example`: disconnected-tunnel detector and recovery
- `com.devspace.cloudflare-tunnel-watchdog.plist.example`: once-per-minute watchdog

The wrapper intentionally contains only current settings. It does not include
obsolete tool-mode, tool-naming, or skill environment variables.

## Validation

Before loading the LaunchAgents:

```bash
plutil -lint /path/to/rendered/com.devspace.server.plist
plutil -lint /path/to/rendered/com.devspace.cloudflare-tunnel.plist
plutil -lint /path/to/rendered/com.devspace.cloudflare-tunnel-watchdog.plist
cloudflared tunnel --config /path/to/rendered/config.yml ingress validate
```

After loading:

```bash
launchctl print gui/$(id -u)/com.devspace.server
launchctl print gui/$(id -u)/com.devspace.cloudflare-tunnel
launchctl print gui/$(id -u)/com.devspace.cloudflare-tunnel-watchdog
curl --fail http://127.0.0.1:60123/metrics
cloudflared tunnel info <tunnel-name-or-id>
npm run verify:public -- https://your-devspace-host.example.com
```

Keep the Owner password in `~/.devspace/auth.json` or the service environment,
never in these checked-in templates.

## Tunnel Watchdog

Render the watchdog script to
`~/.local/share/devspace-ops/devspace-tunnel-watchdog.sh`, make it executable,
and render its LaunchAgent with the public hostname. The tunnel LaunchAgent uses
the fixed loopback metrics endpoint `127.0.0.1:60123`; do not expose that port
on a non-loopback interface.

The watchdog restarts only `com.devspace.cloudflare-tunnel`, and only after two
consecutive checks establish all of the following:

- local DevSpace `/healthz` returns `200`;
- public DevSpace `/healthz` does not return `200`;
- `cloudflared_tunnel_ha_connections` is zero or the fixed metrics endpoint is
  unavailable.

Checks run once per minute and successful restarts have a five-minute cooldown.
The watchdog deliberately takes no action when local DevSpace is unhealthy, so
it cannot hide or amplify a server failure. Set
`DEVSPACE_TUNNEL_WATCHDOG_DRY_RUN=1` in a test LaunchAgent to validate the
decision path without restarting the tunnel.

Before changing a rendered LaunchAgent, copy it to a timestamped directory under
`~/.local/state/devspace/backups/`. To roll back, unload the watchdog, restore
the previous tunnel LaunchAgent, and restart only the tunnel:

```bash
launchctl bootout gui/$(id -u)/com.devspace.cloudflare-tunnel-watchdog
launchctl bootout gui/$(id -u)/com.devspace.cloudflare-tunnel
cp /path/to/backup/com.devspace.cloudflare-tunnel.plist \
  ~/Library/LaunchAgents/com.devspace.cloudflare-tunnel.plist
launchctl bootstrap gui/$(id -u) \
  ~/Library/LaunchAgents/com.devspace.cloudflare-tunnel.plist
```
