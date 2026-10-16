/**
 * Link status checker.
 *
 * This lives in the background worker, not the content script, because the page
 * cannot read a cross-origin status code - that is exactly what CORS blocks.
 * Inside an extension, the `<all_urls>` host permission grants the bypass, so
 * plain `fetch` works here.
 *
 * Rules from the plan:
 *   - HEAD first, fall back to GET on failure or 405/501
 *   - at most LINK_CHECK_CONCURRENCY requests in flight
 *   - LINK_CHECK_TIMEOUT_MS per request
 *   - each unique URL is checked once per run
 *   - cap at LINK_CHECK_MAX_URLS so a link-heavy page cannot hammer a server
 */
import {
  BROKEN_STATUS_MIN,
  LINK_CHECK_CONCURRENCY,
  LINK_CHECK_MAX_URLS,
  LINK_CHECK_TIMEOUT_MS,
  REDIRECT_STATUSES,
} from "../shared/config";
import type { LinkCheck } from "../shared/types";

/** Statuses that mean "this server will not answer HEAD, use GET instead". */
const HEAD_UNSUPPORTED = new Set([400, 403, 405, 501]);

/** Progress is reported at most this often, to keep the port quiet. */
const PROGRESS_INTERVAL_MS = 120;

export interface CheckerCallbacks {
  onStarted: (total: number) => void;
  onResult: (url: string, check: LinkCheck) => void;
  onProgress: (checked: number, total: number) => void;
}

/**
 * fetch with a per-request timeout that also aborts when the whole run is
 * cancelled. The two signals are combined because AbortSignal.any() is not
 * available everywhere we run.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  runSignal: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();

  const onRunAbort = () => controller.abort();
  runSignal.addEventListener("abort", onRunAbort, { once: true });

  const timer = setTimeout(() => controller.abort(), LINK_CHECK_TIMEOUT_MS);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    runSignal.removeEventListener("abort", onRunAbort);
  }
}

function classify(status: number, started: number): LinkCheck {
  return {
    status: status >= BROKEN_STATUS_MIN ? "broken" : "ok",
    statusCode: status,
    finalUrl: null,
    redirectStatus: null,
    redirected: false,
    error: null,
    durationMs: Math.round(performance.now() - started),
  };
}

function failure(reason: string, started: number): LinkCheck {
  return {
    // The plan treats a timeout or network error as a broken link.
    status: "broken",
    statusCode: null,
    finalUrl: null,
    redirectStatus: null,
    redirected: false,
    error: reason,
    durationMs: Math.round(performance.now() - started),
  };
}

/**
 * `redirect: "manual"` is the key trick. Inside an extension the response is not
 * opaque, so a 301/302 comes back with a readable status and a readable
 * `Location` header - which is the only way to report *which* redirect happened
 * and where it points, rather than just the final URL.
 */
async function probe(
  url: string,
  method: "HEAD" | "GET",
  runSignal: AbortSignal,
): Promise<Response> {
  return fetchWithTimeout(
    url,
    {
      method,
      redirect: "manual",
      // No cookies: it keeps us out of the site's session and avoids auth
      // redirects looking like real ones.
      credentials: "omit",
      // A cached 200 would hide a link that is now broken.
      cache: "no-store",
      referrerPolicy: "no-referrer",
    },
    runSignal,
  );
}

async function checkOne(url: string, runSignal: AbortSignal): Promise<LinkCheck> {
  const started = performance.now();

  let response: Response;
  let method: "HEAD" | "GET" = "HEAD";

  try {
    response = await probe(url, method, runSignal);
    if (HEAD_UNSUPPORTED.has(response.status)) {
      // Some servers reject HEAD outright; ask again for real.
      method = "GET";
      response = await probe(url, method, runSignal);
    }
  } catch (error) {
    if (runSignal.aborted) throw error;
    // AbortError here is our per-request timeout, not the run being cancelled.
    const timedOut = error instanceof DOMException && error.name === "AbortError";
    return failure(timedOut ? "timeout" : "network error", started);
  }

  // Cancel the body immediately: with GET we only want the headers, and
  // downloading a multi-megabyte response would be pointless.
  await response.body?.cancel().catch(() => {});

  if (REDIRECT_STATUSES.has(response.status)) {
    const location = response.headers.get("location");
    const resolved = location ? new URL(location, url).href : null;

    if (resolved && resolved !== url) {
      // One more request so we can report the destination's real status too.
      try {
        const final = await probe(resolved, method, runSignal);
        await final.body?.cancel().catch(() => {});
        const result = classify(final.status, started);
        return {
          ...result,
          finalUrl: final.url || resolved,
          redirectStatus: response.status,
          redirected: true,
        };
      } catch {
        // The destination could not be reached; the redirect itself is still
        // a real finding, so report what we know.
        return {
          ...classify(response.status, started),
          finalUrl: resolved,
          redirectStatus: response.status,
          redirected: true,
        };
      }
    }

    return {
      ...classify(response.status, started),
      finalUrl: resolved,
      redirectStatus: response.status,
      redirected: true,
    };
  }

  const result = classify(response.status, started);
  // `response.url` differs from the request when the browser followed a hop we
  // did not see, e.g. an HSTS upgrade.
  return response.url && response.url !== url ? { ...result, finalUrl: response.url } : result;
}

/**
 * Runs the whole queue with a fixed number of workers.
 *
 * `urls` is deduped and capped here as well as in the panel, because this is the
 * component that decides how much traffic we generate.
 */
export async function runLinkCheck(
  urls: string[],
  runSignal: AbortSignal,
  callbacks: CheckerCallbacks,
): Promise<void> {
  const unique = Array.from(new Set(urls));
  const queue = unique.slice(0, LINK_CHECK_MAX_URLS);

  callbacks.onStarted(queue.length);
  callbacks.onProgress(0, queue.length);

  if (queue.length === 0) return;

  let cursor = 0;
  let completed = 0;
  let lastReport = 0;

  const report = () => {
    const now = performance.now();
    if (now - lastReport < PROGRESS_INTERVAL_MS && completed < queue.length) return;
    lastReport = now;
    callbacks.onProgress(completed, queue.length);
  };

  async function worker(): Promise<void> {
    while (!runSignal.aborted) {
      const index = cursor++;
      if (index >= queue.length) return;

      const url = queue[index];
      try {
        const check = await checkOne(url, runSignal);
        callbacks.onResult(url, check);
      } catch {
        // Only the run being cancelled reaches here; individual failures are
        // already turned into a "broken" result by checkOne.
        return;
      }
      completed += 1;
      report();
    }
  }

  const workerCount = Math.min(LINK_CHECK_CONCURRENCY, queue.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  if (!runSignal.aborted) callbacks.onProgress(completed, queue.length);
}
