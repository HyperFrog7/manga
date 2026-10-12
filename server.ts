import { proxyMangadex } from "./mangadex";
import { proxyPill, proxyImage } from "./mangapill";

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const IMG_PREFIX = process.env.IMG_PREFIX || "/img";

function json(data: unknown, status = 200, cache = true): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": status === 200 && cache ? "public, max-age=300" : "no-store",
    },
  });
}

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const { pathname } = url;

  if (req.method !== "GET")
    return new Response("Method not allowed", { status: 405 });

  if (pathname === "/img") {
    return proxyImage(url.searchParams.get("u") || "");
  }

  if (pathname.startsWith("/pill/")) {
    const result = await proxyPill(pathname, url.searchParams, fetch, IMG_PREFIX);
    return json(result.body, result.status);
  }

  if (pathname.startsWith("/mangadex/") || pathname === "/mangadex") {
    const result = await proxyMangadex(pathname, url.searchParams);
    return json(result.body, result.status);
  }

  if (pathname === "/healthz") return new Response("ok");

  return json({ error: "not found" }, 404, false);
}

const server = Bun.serve({ hostname: HOST, port: PORT, fetch: handle });
console.log(`manga-api listening on http://${HOST}:${server.port}`);
