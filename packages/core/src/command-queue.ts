/** Preserve click order for one device while allowing different devices to update together. */
export class EntityActionQueue {
  private pending = new Map<string, Promise<unknown>>();
  run<T>(entityId: string, operation: () => Promise<T>): Promise<T> {
    const result = (this.pending.get(entityId) ?? Promise.resolve())
      .catch(() => {})
      .then(operation);
    this.pending.set(entityId, result);
    void result
      .finally(() => {
        if (this.pending.get(entityId) === result) this.pending.delete(entityId);
      })
      .catch(() => {});
    return result;
  }
}
