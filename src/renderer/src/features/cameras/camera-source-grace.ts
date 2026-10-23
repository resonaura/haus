const GRACE_MS = 30_000;
const uncertain = (state: string) => ['unknown', 'unavailable'].includes(state);

/** Preserve an established live viewer through a brief HA availability wobble. */
export class CameraSourceGrace {
  private available: boolean;
  private off: boolean;
  private deadline: number | undefined;

  constructor(state: string) {
    this.available = !uncertain(state) && state !== 'off';
    this.off = state === 'off';
  }

  observe(state: string, now: number) {
    if (state === 'off') {
      this.available = false;
      this.off = true;
      this.deadline = undefined;
      return false;
    }
    if (!uncertain(state)) {
      this.available = true;
      this.off = false;
      this.deadline = undefined;
      return true;
    }
    if (this.off) return false;
    if (this.available) {
      this.available = false;
      this.deadline = now + GRACE_MS;
    }
    return this.deadline !== undefined && now < this.deadline;
  }

  remaining(now: number) {
    return Math.max(0, (this.deadline ?? now) - now);
  }
}

export const cameraSourceAvailable = (state: string) => !uncertain(state) && state !== 'off';
