# CloudNS domain → Render reverse proxy → Cloudflare Quick Tunnel → localhost

This project relays requests from a Render Web Service to a Cloudflare Quick Tunnel running on your PC. It lets CloudNS remain your authoritative DNS provider because your root domain points to Render, not directly to Cloudflare Tunnel.

## Important limitations

- Quick Tunnel URLs are temporary and can change after restart.
- Render Free Web Services may sleep, have resource/bandwidth limits, and are not a guaranteed always-on reverse-proxy tier. The local manager sends a registration heartbeat every 60 seconds to help keep the service active, but free-tier behavior/limits can change.
- Your PC and local website must stay online.
- This is a practical prototype, not a high-availability production architecture. Large uploads, streaming, WebSockets, and application-specific absolute URLs should be tested.
- The manager currently expects your local site at `http://127.0.0.1:3000`. Change `LOCAL_PORT` in `local_manager.py` if needed.

## 1. Deploy the bridge to Render

1. Upload these files to a GitHub repository.
2. In Render, create **New → Web Service** and connect the repository.
3. Runtime: Node. Build command: `npm install`. Start command: `npm start`.
4. Add an Environment Variable:
   - Key: `REGISTER_TOKEN`
   - Value: generate a long random secret (at least 32 characters). Keep it private.
5. Deploy and wait until the service is live. Test `https://YOUR-SERVICE.onrender.com/_health`; it should return JSON with `ok: true` and `connected: false`.

Do not commit the token into GitHub or share it publicly.

## 2. Attach your root domain in Render

1. Render service → **Settings → Custom Domains** → add `yourdomain.com`.
2. Copy the exact DNS instructions shown by Render.
3. In CloudNS, update only the records needed for the root domain as instructed by Render. For a root/apex domain, use the exact A/ALIAS/ANAME option Render currently requests. Do not guess an IP if the dashboard gives different instructions.
4. If you use email or other DNS services, preserve all existing MX/TXT and unrelated records.
5. Wait for Render to verify the domain and issue TLS. Test `https://yourdomain.com/_health`.

## 3. Run the local manager on Windows

Requirements: Python 3 and `cloudflared` installed and available on PATH. Your site must already be running at `http://localhost:3000`.

Run from this folder:

```powershell
py local_manager.py
```

Enter:
- the Render service URL, e.g. `https://your-bridge.onrender.com`
- the exact `REGISTER_TOKEN` value configured in Render

When cloudflared prints a `https://....trycloudflare.com` URL, the manager registers it with Render and re-registers every 60 seconds. Leave the terminal open.

## 4. Test

1. Open `https://YOUR-SERVICE.onrender.com/_health`; `connected` should become `true`.
2. Open `https://yourdomain.com` from a different network/mobile data.
3. If you get `503`, the manager has not registered a tunnel yet.
4. If you get `502`, check that the local site is running on port 3000 and the Quick Tunnel is still alive.

## Security notes

- `/_register` is protected by the bearer token and only accepts HTTPS `*.trycloudflare.com` targets.
- Treat the token like a password. If exposed, rotate it in Render Environment and restart the service.
- Do not expose development servers with debug consoles or unauthenticated admin endpoints.
- The proxy passes visitor requests to your local app. Your local app should not assume every request comes directly from a trusted client.

## Architecture

`Visitor → https://yourdomain.com (CloudNS DNS) → Render HTTPS service → current trycloudflare.com URL → cloudflared on your PC → localhost:3000`
