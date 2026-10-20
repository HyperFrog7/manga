# manga

Manga API server with two sources: [MangaDex](https://mangadex.org) (API proxy) and [MangaPill](https://mangapill.com) (scraper). Built with Bun.

Both sources return the same response shapes, filter to safe content only, and serve English translations.

## Setup

```bash
bun install
bun run start
```

Runs on `http://127.0.0.1:3000` by default. Set `PORT` and `HOST` env vars to change.

## Routes

### MangaDex (`/mangadex/...`)

| Route | Description |
|---|---|
| `GET /mangadex/search?title=&offset=` | Search (or trending if no title) |
| `GET /mangadex/latest?offset=` | Recently updated series |
| `GET /mangadex/:uuid` | Series detail |
| `GET /mangadex/:uuid/chapters?offset=` | Chapter list |
| `GET /mangadex/chapter/:uuid/pages` | Page image URLs |

### MangaPill (`/pill/...`)

| Route | Description |
|---|---|
| `GET /pill/search?title=&page=` | Search (or recently updated if no title) |
| `GET /pill/title/:id/:slug` | Series detail |
| `GET /pill/title/:id/:slug/chapters` | Chapter list |
| `GET /pill/chapter/:id/:slug/pages` | Page image URLs |

### Image proxy

| Route | Description |
|---|---|
| `GET /img?u=<url>` | Proxies MangaPill CDN images (required — their CDN blocks direct hotlinking) |

## Deploying

The repo includes a `Dockerfile` and a Render Blueprint (`render.yaml`). On
Render, create a new **Blueprint** from this repository, or create a **Web
Service** with runtime **Docker**. Render supplies `PORT`; the server binds to
`HOST=0.0.0.0`.

Set the resulting URL (for example `https://manga-api.onrender.com`) as the
Manga API URL in Drift's Settings. The server sends permissive CORS headers for
the JSON routes and the image proxy, so Drift can call it directly from the
static app.

Render's free web services sleep after inactivity, so the first request after
idle can take 30–60 seconds. A small uptime pinger can keep it warm if that
matters.

## Using as a library

Import the source modules directly instead of running the server:

```ts
import { proxyMangadex } from "./mangadex";
import { proxyPill, proxyImage } from "./mangapill";

const result = await proxyMangadex("/mangadex/search", new URLSearchParams({ title: "one piece" }));
console.log(result.body);
```

Both `proxyMangadex` and `proxyPill` accept an optional `fetchImpl` parameter if you need to customize the HTTP client.

## Response shapes

**Search / Latest**
```json
{ "total": 100, "items": [{ "id": "...", "title": "...", "cover": "..." }], "next": 24 }
```

**Detail**
```json
{ "id": "...", "title": "...", "cover": "...", "description": "...", "status": "ongoing", "year": 2020, "tags": ["Action"], "authors": ["..."] }
```

**Chapters**
```json
{ "total": 50, "chapters": [{ "id": "...", "chapter": "1", "title": "...", "pages": 20 }] }
```

**Pages**
```json
{ "pages": ["https://..."] }
```
