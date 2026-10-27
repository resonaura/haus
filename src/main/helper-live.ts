import WebSocket from 'ws';
import type { NativeEvent } from '../shared/native';

type Surface = { url: string; cookie?: string };
/** The credentials stay in main; renderer receives scoped invalidations only. */
export class HelperLive {
  private socket?: WebSocket;
  private retry?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setTimeout>;
  private epoch = 0;
  private failures = 0;
  private opening = false;
  private ready = false;
  private instance = '';
  private sequence = 0;
  private previous = '';
  constructor(
    private surface: () => Promise<Surface>,
    private scope: () => string | undefined,
    private emit: (event: NativeEvent) => void,
  ) {}
  get connected() {
    return this.ready;
  }
  start() {
    if (this.socket || this.opening || this.retry || !this.scope()) return;
    const epoch = this.epoch,
      scope = this.scope()!;
    this.opening = true;
    void this.surface()
      .then((surface) => {
        if (epoch !== this.epoch || scope !== this.scope()) return;
        const url = new URL('api/live', surface.url);
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        const socket = new WebSocket(url, {
          headers: {
            'X-Haus-Client': '1',
            ...(surface.cookie ? { Cookie: `ingress_session=${surface.cookie}` } : {}),
          },
          handshakeTimeout: 10000,
          maxPayload: 65536,
          perMessageDeflate: false,
          followRedirects: false,
        });
        this.socket = socket;
        const touch = () => {
          clearTimeout(this.heartbeat);
          this.heartbeat = setTimeout(() => socket.terminate(), 50000);
        };
        socket.on('ping', touch);
        socket.on('message', (bytes) => {
          if (epoch !== this.epoch || scope !== this.scope()) return;
          let data;
          try {
            data = JSON.parse(bytes.toString());
          } catch {
            return socket.terminate();
          }
          if (
            data.protocol !== 1 ||
            typeof data.instance !== 'string' ||
            !/^[a-f0-9-]{36}$/.test(data.instance) ||
            !Number.isSafeInteger(data.sequence) ||
            data.sequence < 1 ||
            !['home', 'preferences', 'cameras', 'heartbeat'].includes(data.topic) ||
            typeof data.connected !== 'boolean' ||
            typeof data.revision !== 'string' ||
            !/^(0|[a-f0-9-]{36})$/.test(data.revision)
          )
            return socket.terminate();
          if (data.instance === this.instance && data.sequence <= this.sequence) return;
          const sources =
            Array.isArray(data.sources) &&
            data.sources.length <= 256 &&
            data.sources.every(
              (source: { id?: unknown; available?: unknown; expiresAt?: unknown }) =>
                typeof source?.id === 'string' &&
                /^camera\.[a-z0-9_]+$/.test(source.id) &&
                typeof source.available === 'boolean' &&
                Number.isSafeInteger(source.expiresAt) &&
                Number(source.expiresAt) >= 0 &&
                Number(source.expiresAt) <= Date.now() + 120000,
            )
              ? data.sources.map(
                  (source: { id: string; available: boolean; expiresAt: number }) => ({
                    id: source.id,
                    available: source.available,
                    expiresAt: source.expiresAt,
                  }),
                )
              : undefined;
          const reconnected = !this.ready;
          this.ready = true;
          this.failures = 0;
          this.instance = data.instance;
          this.sequence = data.sequence;
          touch();
          const signature = `${data.instance}:${data.revision}:${data.connected}:${JSON.stringify(sources)}`;
          if (reconnected || signature !== this.previous || data.topic === 'cameras') {
            this.previous = signature;
            this.emit({
              type: 'helper-live',
              scope,
              online: true,
              haConnected: data.connected,
              revision: data.revision,
              topic: data.topic === 'cameras' ? 'cameras' : 'home',
              ...(sources ? { sources } : {}),
            });
          }
        });
        socket.on('error', () => {});
        socket.on('unexpected-response', (_request, response) => {
          response.resume();
          socket.terminate();
        });
        socket.on('close', () => {
          if (this.socket !== socket) return;
          this.socket = undefined;
          clearTimeout(this.heartbeat);
          if (this.ready) this.emit({ type: 'helper-live', scope, online: false });
          this.ready = false;
          this.schedule(epoch);
        });
      })
      .catch(() => this.schedule(epoch))
      .finally(() => {
        if (epoch === this.epoch) this.opening = false;
      });
  }
  private schedule(epoch: number) {
    if (epoch !== this.epoch || this.retry || !this.scope()) return;
    this.retry = setTimeout(
      () => {
        this.retry = undefined;
        this.start();
      },
      Math.min(30000, 1000 * 2 ** Math.min(this.failures++, 5)) + Math.random() * 300,
    );
  }
  stop() {
    ++this.epoch;
    this.opening = false;
    this.ready = false;
    this.previous = '';
    this.instance = '';
    this.sequence = 0;
    this.failures = 0;
    clearTimeout(this.retry);
    clearTimeout(this.heartbeat);
    this.retry = undefined;
    const socket = this.socket;
    this.socket = undefined;
    socket?.terminate();
  }
}
