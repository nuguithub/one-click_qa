/**
 * Tiny static file server for local testing. No dependencies.
 *
 * The extension's content script only matches http/https pages, so a test page
 * cannot be opened with file://. Run `npm run serve`, then open
 * http://localhost:4173/test/fixture.html
 *
 * It also serves a handful of routes that exist purely to exercise the link
 * checker's branches. Using local routes instead of real sites keeps the test
 * deterministic and keeps the traffic off third-party servers.
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const PORT = Number(process.env.PORT ?? 4173);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://localhost:${PORT}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === "/") pathname = "/test/fixture.html";

    // --- routes that exercise the link checker --------------------------

    // 404: the plain "broken link" case.
    if (pathname === "/not-found") {
      response.writeHead(404, { "content-type": "text/plain" }).end("Not found");
      return;
    }

    // 500: a server-side failure rather than a missing page.
    if (pathname === "/server-error") {
      response.writeHead(500, { "content-type": "text/plain" }).end("Boom");
      return;
    }

    // 405 on HEAD but 200 on GET: proves the HEAD -> GET fallback works.
    if (pathname === "/head-not-allowed") {
      if (request.method === "HEAD") {
        response.writeHead(405, { allow: "GET", "content-type": "text/plain" }).end();
      } else {
        response.writeHead(200, { "content-type": "text/plain" }).end("ok");
      }
      return;
    }

    // 301/302: proves redirect detection and final-URL reporting. The
    // `status` query parameter lets the fixture test a redirect that lands on a
    // broken page as well as one that lands on a good page.
    if (pathname === "/redirect-to") {
      const target = url.searchParams.get("url") ?? "/test/fixture.html";
      response.writeHead(302, { location: new URL(target, url).href }).end();
      return;
    }

    // Hangs past the checker's timeout, to exercise the timeout branch.
    if (pathname === "/slow") {
      setTimeout(() => {
        if (!response.writableEnded) response.writeHead(200).end("slow");
      }, 30_000);
      return;
    }

    /**
     * A link-heavy page, generated rather than committed, so the 250-URL cap and
     * the concurrency limit can be exercised. /test/many-links?n=300
     */
    if (pathname === "/test/many-links") {
      const count = Math.min(Number(url.searchParams.get("n") ?? 300) || 300, 2000);
      const rows = Array.from(
        { length: count },
        (_unused, index) =>
          // Every tenth link is broken, so broken-link handling is visible in
          // among the volume.
          `<li><a href="/${index % 10 === 0 ? "not-found" : "ok-" + index}">Link number ${index}</a></li>`,
      ).join("\n");

      response.writeHead(200, { "content-type": MIME[".html"], "cache-control": "no-store" });
      response.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Many links (${count})</title>
    <meta name="description" content="Generated page with ${count} links, for testing the link checker at volume." />
  </head>
  <body>
    <h1>Many links</h1>
    <p>${count} links. The checker caps at 250, so the panel should report the rest as skipped.</p>
    <ul>
${rows}
    </ul>
  </body>
</html>
`);
      return;
    }

    /**
     * Any /ok... path is a healthy link. Without this the generated page's
     * "good" links would 404 as static files and every row would be red, which
     * makes it impossible to tell volume handling apart from broken-link
     * handling.
     */
    if (pathname.startsWith("/ok")) {
      response.writeHead(200, { "content-type": "text/plain" }).end("ok");
      return;
    }

    // --- static files ----------------------------------------------------

    // normalize() collapses "..", so a request cannot escape the project root.
    const filePath = join(ROOT, normalize(pathname).replace(/^(\.\.[/\\])+/, ""));
    if (!filePath.startsWith(ROOT)) {
      response.writeHead(403).end("Forbidden");
      return;
    }

    const info = await stat(filePath);
    if (info.isDirectory()) {
      response.writeHead(404).end("Not found");
      return;
    }

    const body = await readFile(filePath);
    response.writeHead(200, {
      "content-type": MIME[extname(filePath)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(body);
  } catch {
    response.writeHead(404).end("Not found");
  }
});

server.listen(PORT, () => {
  console.log(`Test page:      http://localhost:${PORT}/test/fixture.html`);
  console.log(`Link volume:    http://localhost:${PORT}/test/many-links?n=300`);
  console.log("Link checker routes: /not-found /server-error /head-not-allowed /redirect-to /slow");
});
