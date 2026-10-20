/** Short-lived signalling metadata only; never retains a stream, SDP or microphone. */
export class CameraMetadataCache {
  private entries = new Map<string, { expires: number; result: Promise<unknown> }>();
  constructor(private readonly now = () => Date.now()) {}

  request<T>(message: Record<string, unknown>, load: () => Promise<T>): Promise<T> {
    if (
      !['camera/capabilities', 'camera/webrtc/get_client_config'].includes(String(message.type)) ||
      !/^camera\.[a-z0-9_]+$/.test(String(message.entity_id)) ||
      Object.keys(message).some((key) => !['type', 'entity_id'].includes(key))
    )
      return load();
    const key = `${message.type}:${message.entity_id}`;
    const existing = this.entries.get(key);
    if (existing && existing.expires > this.now()) return existing.result as Promise<T>;
    if (this.entries.size >= 64) this.entries.delete(this.entries.keys().next().value!);
    const entry = { expires: this.now() + 30_000, result: Promise.resolve().then(load) };
    this.entries.set(key, entry);
    void entry.result.catch(() => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
    });
    return entry.result;
  }
  clear(): void {
    this.entries.clear();
  }
}
