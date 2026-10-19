type Resume = (start: number, end: number, signal: AbortSignal) => Promise<Response>;
/** Resume an interrupted recording at the exact next byte; never replay an already delivered chunk. */
export function resilientMediaBody(
  response: Response,
  resume: Resume,
  signal: AbortSignal,
  { readTimeout = 6000, headerTimeout = 4000 } = {},
) {
  if (!response.body || ![200, 206].includes(response.status)) return response.body;
  const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') ?? '');
  const declaredLength = response.headers.get('content-length');
  const length =
    declaredLength === null && range
      ? Number(range[2]) - Number(range[1]) + 1
      : Number(declaredLength);
  if (!Number.isSafeInteger(length) || length <= 0 || (response.status === 206 && !range))
    return response.body;
  const start = range ? Number(range[1]) : 0;
  const end = start + length - 1;
  const total = range ? Number(range[3]) : length;
  let reader = response.body.getReader(),
    received = 0,
    attempts = 0,
    cancelled = false;
  const connection = new AbortController();
  const active = AbortSignal.any([signal, connection.signal]);
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      while (!cancelled) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          active.throwIfAborted();
          const result = await Promise.race([
            reader.read(),
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new Error('Recording transfer stalled.')),
                readTimeout,
              );
            }),
          ]);
          clearTimeout(timer);
          if (result.done) {
            if (received !== length) throw new Error('Recording transfer ended early.');
            controller.close();
            return;
          }
          if (received + result.value.byteLength > length)
            throw new Error('Unexpected recording length.');
          received += result.value.byteLength;
          controller.enqueue(result.value);
          if (received === length) controller.close();
          return;
        } catch (reason) {
          clearTimeout(timer);
          void reader.cancel().catch(() => {});
          if (cancelled) return;
          if (active.aborted || ++attempts > 2) {
            controller.error(reason);
            return;
          }
          const headers = new AbortController();
          const deadline = setTimeout(() => headers.abort(), headerTimeout);
          try {
            const next = await resume(
              start + received,
              end,
              AbortSignal.any([active, headers.signal]),
            );
            const expected = `bytes ${start + received}-${end}/${total}`;
            if (
              next.status !== 206 ||
              next.headers.get('content-range') !== expected ||
              (next.headers.has('content-length') &&
                Number(next.headers.get('content-length')) !== length - received) ||
              !next.body
            ) {
              await next.body?.cancel();
              throw new Error('Recording continuation did not match.');
            }
            reader = next.body.getReader();
          } catch (error) {
            controller.error(error);
            return;
          } finally {
            clearTimeout(deadline);
          }
        }
      }
    },
    async cancel() {
      cancelled = true;
      connection.abort();
      await reader.cancel().catch(() => {});
    },
  });
}
