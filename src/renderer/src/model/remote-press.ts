/** One HA held command per gesture; HA releases it after its bounded hold_secs. */
export class RemotePressGesture {
  private timer?: ReturnType<typeof setTimeout>;
  private active?: string;
  private held = false;
  private cancelled = false;

  constructor(
    private readonly send: (command: string, held: boolean) => void,
    private readonly thresholdMs = 550,
  ) {}

  start(command: string) {
    this.cancel();
    this.active = command;
    this.held = this.cancelled = false;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.active !== command || this.cancelled) return;
      this.held = true;
      this.send(command, true);
    }, this.thresholdMs);
  }

  end(command: string) {
    if (this.active === command) clearTimeout(this.timer);
  }

  press(command: string) {
    clearTimeout(this.timer);
    const send = !this.held && !this.cancelled;
    this.active = undefined;
    this.held = this.cancelled = false;
    if (send) this.send(command, false);
  }

  cancel() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.cancelled = Boolean(this.active);
    this.active = undefined;
  }
}
