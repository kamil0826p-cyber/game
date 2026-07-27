const frontendBaseUrl = (): URL => {
  const origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
  const basePath = import.meta.env.BASE_URL || '/';
  return new URL(basePath, `${origin}/`);
};

export const publicAssetUrl = (path: string): string =>
  new URL(path.replace(/^\/+/, ''), frontendBaseUrl()).toString();

const looksLikeHtml = (body: string, contentType: string): boolean => {
  const normalizedBody = body.trimStart().toLowerCase();
  return (
    contentType.toLowerCase().includes('text/html') ||
    normalizedBody.startsWith('<!doctype html') ||
    normalizedBody.startsWith('<html')
  );
};

export const fetchJsonResource = async (
  url: string,
  label: string,
  init: RequestInit = {},
): Promise<unknown> => {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');

  const response = await fetch(url, { ...init, headers });
  const body = await response.text();
  const responseUrl = response.url || url;

  if (!response.ok) {
    throw new Error(`${label} could not be loaded from ${responseUrl} (${response.status}).`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (looksLikeHtml(body, contentType)) {
    throw new Error(
      `${label} returned HTML instead of JSON from ${responseUrl}. ` +
        'The static asset path is missing or the frontend build is stale.',
    );
  }

  try {
    return JSON.parse(body) as unknown;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} contains invalid JSON at ${responseUrl}: ${reason}`);
  }
};
