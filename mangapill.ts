import * as cheerio from "cheerio";

const SITE = "https://mangapill.com";
const IMAGE_HOST = "cdn.readdetectiveconan.com";
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const NUM = /^\d{1,7}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,200}$/i;
const CHAPTER_ID = /^\d{1,7}-\d{1,12}$/;
const MAX_PAGE = 200;
const BLOCKED_GENRES = new Set([
  "hentai", "adult", "mature", "smut", "ecchi", "erotica",
  "pornographic", "sexual violence",
]);
const VERDICT_TTL = 6 * 60 * 60 * 1000;
const VERDICT_LIMIT = 5000;
const CHECK_CONCURRENCY = 20;
const verdicts = new Map<string, { safe: boolean; at: number }>();

export function proxiedImage(url: string, prefix = "/img"): string {
  return `${prefix}?u=${encodeURIComponent(url)}`;
}

export function isAllowedImage(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const ok =
    url.protocol === "https:" &&
    url.hostname === IMAGE_HOST &&
    url.pathname.startsWith("/file/");
  return ok ? url : null;
}

const text = (value: string | undefined) =>
  (value || "").replace(/\s+/g, " ").trim();

export function parseList(html: string, page: number, imgPrefix = "/img") {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const items: { id: string; title: string; cover: string }[] = [];
  $("a[href^='/manga/']").each((_, link) => {
    const href = $(link).attr("href") || "";
    const match = href.match(/^\/manga\/(\d+)\/([^/?#]+)$/);
    const card = $(link).parent();
    const img = card.find("figure img").first();
    if (!match || !img.length || seen.has(href)) return;
    seen.add(href);
    const title =
      text(card.find(".font-black").first().text()) || text(img.attr("alt"));
    const src = img.attr("data-src") || img.attr("src") || "";
    items.push({
      id: `${match[1]}/${match[2]}`,
      title: title || match[2],
      cover: isAllowedImage(src) ? proxiedImage(src, imgPrefix) : "",
    });
  });
  return {
    total: 0,
    items,
    next: items.length && page < MAX_PAGE ? page + 1 : null,
  };
}

export function parseTrending(html: string, imgPrefix = "/img") {
  const $ = cheerio.load(html);
  const heading = $("h4")
    .filter((_, el) => text($(el).text()).toLowerCase() === "trending mangas")
    .first();
  const container = heading.closest(".container");
  const seen = new Set<string>();
  const items: { id: string; title: string; cover: string }[] = [];
  if (!container.length) return { total: 0, items, next: null };
  container.find("a[href^='/manga/']").each((_, link) => {
    const href = $(link).attr("href") || "";
    const match = href.match(/^\/manga\/(\d+)\/([^/?#]+)$/);
    const card = $(link).parent();
    const img = card.find("figure img").first();
    if (!match || !img.length || seen.has(href)) return;
    seen.add(href);
    const title =
      text(card.find(".font-black").first().text()) || text(img.attr("alt"));
    const src = img.attr("data-src") || img.attr("src") || "";
    items.push({
      id: `${match[1]}/${match[2]}`,
      title: title || match[2],
      cover: isAllowedImage(src) ? proxiedImage(src, imgPrefix) : "",
    });
  });
  return { total: 0, items, next: null };
}

export function parseDetail(html: string, id: string, imgPrefix = "/img") {
  const $ = cheerio.load(html);
  const genres = $("a[href*='genre=']")
    .map((_, a) => text($(a).text()))
    .get()
    .filter(Boolean);
  if (
    !genres.length ||
    genres.some((genre) => BLOCKED_GENRES.has(genre.toLowerCase()))
  )
    return null;
  const labels = new Map<string, string>();
  $("label").each((_, label) => {
    labels.set(
      text($(label).text()).toLowerCase(),
      text($(label).next().text()),
    );
  });
  const cover = $("img[data-src]").first().attr("data-src") || "";
  return {
    id,
    title: text($("h1").first().text()) || id,
    cover: isAllowedImage(cover) ? proxiedImage(cover, imgPrefix) : "",
    description: text($("p.text-sm").first().text()),
    status: labels.get("status") || "",
    year: Number(labels.get("year")) || null,
    tags: [...new Set(genres)].slice(0, 8),
    authors: [] as string[],
  };
}

export function parseChapters(html: string) {
  const $ = cheerio.load(html);
  const chapters: {
    id: string;
    chapter: string;
    title: string;
    pages: number;
  }[] = [];
  $("#chapters a[href^='/chapters/']").each((_, link) => {
    const match = ($(link).attr("href") || "").match(
      /^\/chapters\/(\d+-\d+)\/([^/?#]+)$/,
    );
    if (!match) return;
    const label = text($(link).text());
    chapters.push({
      id: `${match[1]}/${match[2]}`,
      chapter: label.match(/Chapter\s+([\d.]+)/i)?.[1] ?? "",
      title: label.replace(/^Chapter\s+[\d.]+\s*:?\s*/i, ""),
      pages: 0,
    });
  });
  return { total: chapters.length, chapters: chapters.reverse() };
}

export function parsePages(html: string, imgPrefix = "/img"): string[] {
  const $ = cheerio.load(html);
  return $("img[data-src]")
    .map((_, img) => $(img).attr("data-src") || "")
    .get()
    .filter((src) => isAllowedImage(src) && src.includes("/file/mangap/"))
    .map((src) => proxiedImage(src, imgPrefix));
}

type Fetch = typeof fetch;
type Result = { status: number; body: unknown };

async function page(fetchImpl: Fetch, path: string): Promise<string | null> {
  const response = await fetchImpl(`${SITE}${path}`, {
    headers: { "user-agent": UA, accept: "text/html" },
    signal: AbortSignal.timeout(12_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`mangapill ${response.status}`);
  return response.text();
}

async function isSafe(
  id: string,
  fetchImpl: Fetch,
  imgPrefix: string,
): Promise<boolean> {
  const known = verdicts.get(id);
  if (known && Date.now() - known.at < VERDICT_TTL) return known.safe;
  let safe = false;
  try {
    const html = await page(fetchImpl, `/manga/${id}`);
    safe = html != null && parseDetail(html, id, imgPrefix) != null;
  } catch {
    return false;
  }
  if (verdicts.size >= VERDICT_LIMIT)
    verdicts.delete(verdicts.keys().next().value!);
  verdicts.set(id, { safe, at: Date.now() });
  return safe;
}

export async function onlySafe<T extends { id: string }>(
  items: T[],
  fetchImpl: Fetch,
  imgPrefix = "/img",
): Promise<T[]> {
  const keep = new Array<boolean>(items.length).fill(false);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      keep[index] = await isSafe(items[index].id, fetchImpl, imgPrefix);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CHECK_CONCURRENCY, items.length) }, worker),
  );
  return items.filter((_, index) => keep[index]);
}

export function clearVerdicts() {
  verdicts.clear();
}

export async function proxyPill(
  pathname: string,
  params: URLSearchParams,
  fetchImpl: Fetch = fetch,
  imgPrefix = "/img",
): Promise<Result> {
  const parts = pathname
    .replace(/^\/?(pill)\/?/, "")
    .split("/")
    .filter(Boolean);
  const notFound = { status: 404, body: { error: "not found" } };
  try {
    if (parts.length === 1 && parts[0] === "search") {
      const pageNo = Math.min(
        Math.max(Number(params.get("page")) || 1, 1),
        MAX_PAGE,
      );
      const title = (params.get("title") || "").trim().slice(0, 100);
      const genre = (params.get("genre") || "").trim().slice(0, 50);
      if (!title && !genre) {
        if (pageNo > 1)
          return { status: 200, body: { total: 0, items: [], next: null } };
        const home = await page(fetchImpl, "/");
        if (!home) return notFound;
        const trending = parseTrending(home, imgPrefix);
        return {
          status: 200,
          body: {
            ...trending,
            items: await onlySafe(trending.items, fetchImpl, imgPrefix),
          },
        };
      }
      const query = new URLSearchParams();
      if (title) query.set("q", title);
      if (genre) query.set("genre", genre);
      query.set("page", String(pageNo));
      const html = await page(fetchImpl, `/search?${query.toString()}`);
      if (!html) return notFound;
      const list = parseList(html, pageNo, imgPrefix);
      const limit = Math.min(
        Math.max(Number(params.get("limit")) || 0, 0),
        50,
      );
      const items = limit > 0 ? list.items.slice(0, limit) : list.items;
      return {
        status: 200,
        body: {
          ...list,
          items: await onlySafe(items, fetchImpl, imgPrefix),
        },
      };
    }

    if (
      parts[0] === "title" &&
      NUM.test(parts[1] || "") &&
      SLUG.test(parts[2] || "")
    ) {
      const html = await page(fetchImpl, `/manga/${parts[1]}/${parts[2]}`);
      if (!html) return notFound;
      if (parts.length === 3) {
        const detail = parseDetail(
          html,
          `${parts[1]}/${parts[2]}`,
          imgPrefix,
        );
        return detail ? { status: 200, body: detail } : notFound;
      }
      if (parts.length === 4 && parts[3] === "chapters") {
        return parseDetail(html, "x", imgPrefix)
          ? { status: 200, body: parseChapters(html) }
          : notFound;
      }
    }

    if (
      parts.length === 4 &&
      parts[0] === "chapter" &&
      parts[3] === "pages" &&
      CHAPTER_ID.test(parts[1]) &&
      SLUG.test(parts[2])
    ) {
      const html = await page(
        fetchImpl,
        `/chapters/${parts[1]}/${parts[2]}`,
      );
      return html
        ? { status: 200, body: { pages: parsePages(html, imgPrefix) } }
        : notFound;
    }
  } catch {
    return { status: 502, body: { error: "mangapill is unreachable" } };
  }
  return notFound;
}

export async function proxyImage(
  raw: string,
  fetchImpl: Fetch = fetch,
): Promise<Response> {
  const headers = {
    "access-control-allow-origin": "*",
    "cross-origin-resource-policy": "cross-origin",
  };
  const url = isAllowedImage(raw);
  if (!url) return new Response("Bad image", { status: 400, headers });
  try {
    const upstream = await fetchImpl(url, {
      headers: { "user-agent": UA, referer: `${SITE}/` },
      signal: AbortSignal.timeout(15_000),
    });
    const type = upstream.headers.get("content-type") || "";
    if (!upstream.ok || !type.startsWith("image/"))
      return new Response("Upstream error", { status: 502, headers });
    return new Response(upstream.body, {
      headers: {
        "content-type": type,
        "cache-control": "public, max-age=86400",
        ...headers,
      },
    });
  } catch {
    return new Response("Upstream error", { status: 502, headers });
  }
}
