# macOS Service Templates

These templates describe the maintained macOS deployment shape:

- an immutable release under `~/.local/share/devspace-releases/`
- `~/.local/share/devspace-runtime` as the active release symlink
- `~/.local/bin/devspace` as the stable wrapper
- one LaunchAgent for DevSpace
- one LaunchAgent for a named Cloudflare Tunnel

Copy the examples outside the repository and replace every `__PLACEHOLDER__`.
Do not commit the rendered files because they contain machine paths and tunnel
identity.

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

- `devspace-wrapper.sh.example`: stable Node/runtime entrypoint
- `com.devspace.server.plist.example`: DevSpace LaunchAgent
- `cloudflared-config.yml.example`: named-tunnel ingress
- `com.devspace.cloudflare-tunnel.plist.example`: tunnel LaunchAgent

The wrapper intentionally contains only current settings. It does not include
obsolete tool-mode, tool-naming, or skill environment variables.

## Validation

Before loading either LaunchAgent:

```bash
plutil -lint /path/to/rendered/com.devspace.server.plist
plutil -lint /path/to/rendered/com.devspace.cloudflare-tunnel.plist
cloudflared tunnel --config /path/to/rendered/config.yml ingress validate
```

After loading:

```bash
launchctl print gui/$(id -u)/com.devspace.server
launchctl print gui/$(id -u)/com.devspace.cloudflare-tunnel
cloudflared tunnel info <tunnel-name-or-id>
npm run verify:public -- https://your-devspace-host.example.com
```

Keep the Owner password in `~/.devspace/auth.json` or the service environment,
never in these checked-in templates.
