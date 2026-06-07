// Tiny fetch helpers with a timeout. Uses Node's built-in fetch (Node 18+).
export async function fetchJson<T = unknown>(
  url: string,
  init: RequestInit = {},
  timeoutMs = 12000,
): Promise<T> {
  return withTimeout(url, init, timeoutMs, (res) => res.json() as Promise<T>);
}

// Same, but for endpoints that return text/CSV rather than JSON.
export async function fetchText(
  url: string,
  init: RequestInit = {},
  timeoutMs = 12000,
): Promise<string> {
  return withTimeout(url, init, timeoutMs, (res) => res.text());
}

async function withTimeout<T>(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  read: (res: Response) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await read(res);
  } finally {
    clearTimeout(timer);
  }
}
