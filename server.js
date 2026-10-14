
import express from "express";
import httpProxy from "http-proxy";
import crypto from "node:crypto";

const app = express();
const proxy = httpProxy.createProxyServer({
  changeOrigin: true,
  xfwd: true,
  ws: true,
  proxyTimeout: 120000,
  timeout: 120000
});

const PORT = process.env.PORT || 10000;
const TOKEN = process.env.TUNNEL_TOKEN;

let target = "";

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "4kb" }));

function authorized(req) {
  const provided = req.get("authorization") || "";
  const expected = `Bearer ${TOKEN || ""}`;

  if (!TOKEN) return false;

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);

  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// PC tunnel manager calls this endpoint.
app.post("/_tunnel/register", (req, res) => {
  if (!authorized(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const url = req.body?.url;

  if (typeof url !== "string") {
    return res.status(400).json({ error: "Missing URL" });
  }

  try {
    const parsed = new URL(url);

    if (
      parsed.protocol !== "https:" ||
      parsed.hostname !== "localhost" &&
      parsed.hostname !== "127.0.0.1" &&
      !parsed.hostname.endsWith(".trycloudflare.com")
    ) {
      return res.status(400).json({ error: "Invalid tunnel URL" });
    }

    target = parsed.origin;
    console.log("Tunnel registered:", parsed.hostname);

    return res.json({ ok: true });
  } catch {
    return res.status(400).json({ error: "Invalid URL" });
  }
});

// Health endpoint for Render.
app.get("/health", (_req, res) => {
  res.json({ ok: true, tunnelConnected: Boolean(target) });
});

// Never expose registration status or secrets publicly.
app.use((req, res) => {
  if (!target) {
    return res.status(503).send("Tunnel is not connected yet.");
  }

  proxy.web(req, res, { target });
});

proxy.on("error", (err, req, res) => {
  console.error("Proxy error:", err.message);

  if (res && !res.headersSent) {
    res.writeHead(502, { "Content-Type": "text/plain" });
  }

  if (res && !res.writableEnded) {
    res.end("Local tunnel is temporarily unavailable.");
  }
});

// WebSocket upgrade support.
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`Proxy listening on ${PORT}`);
});

server.on("upgrade", (req, socket, head) => {
  if (!target) {
    socket.destroy();
    return;
  }

  proxy.ws(req, socket, head, { target });
});
