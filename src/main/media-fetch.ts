/** Bound connection/first-byte latency without cutting off a long video response body. */
export async function fetchMedia(url: string, init: RequestInit, headerTimeout = 4000) {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), headerTimeout);
  try {
    return await fetch(url, {
      ...init,
      signal: AbortSignal.any([deadline.signal, ...(init.signal ? [init.signal] : [])]),
    });
  } finally {
    clearTimeout(timer);
  }
}
