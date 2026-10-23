import { createRequire } from 'node:module';
import type { HapticPattern } from '../shared/native';

/** Public AppKit feedback, on the same main thread as Electron's window. */
function macPerformer(): (pattern: HapticPattern) => boolean {
  const koffi = createRequire(import.meta.url)('koffi') as typeof import('koffi');
  const appKit = koffi.load('/System/Library/Frameworks/AppKit.framework/AppKit');
  const objc = koffi.load('/usr/lib/libobjc.A.dylib');
  const system = koffi.load('/usr/lib/libSystem.B.dylib');
  if (!system.func('int pthread_main_np(void)')()) throw new Error('AppKit requires main.');
  const klass = objc.func('void *objc_lookUpClass(const char *name)');
  const selector = objc.func('void *sel_registerName(const char *name)');
  const object = objc.func('objc_msgSend', 'void *', ['void *', 'void *']);
  const perform = objc.func('objc_msgSend', 'void', ['void *', 'void *', 'long', 'ulong']);
  const manager = klass('NSHapticFeedbackManager');
  if (!manager) throw new Error('Haptic feedback unavailable.');
  const defaultPerformer = selector('defaultPerformer');
  const feedback = selector('performFeedbackPattern:performanceTime:');
  return (pattern) => {
    // Fetch the current device each time. AppKit respects device support and
    // the user's system preferences; it also requires contact with a trackpad.
    void appKit;
    const current = object(manager, defaultPerformer);
    if (current)
      perform(current, feedback, pattern === 'generic' ? 0 : pattern === 'alignment' ? 1 : 2, 1);
    // PerformanceTimeNow (1) is required for renderer IPC, outside tracking loops.
    return Boolean(current);
  };
}

/** Coalescing is native too, so multiple UI sources cannot create a buzz. */
export class NativeHaptics {
  private lastAt = -Infinity;
  private attempted = false;
  private performer?: (pattern: HapticPattern) => boolean;
  constructor(
    private readonly platform = process.platform,
    private readonly load = macPerformer,
    private readonly now = () => performance.now(),
  ) {}
  perform(pattern: unknown): boolean {
    if (
      this.platform !== 'darwin' ||
      typeof pattern !== 'string' ||
      !['generic', 'alignment', 'levelChange'].includes(pattern)
    )
      return false;
    const at = this.now();
    if (at - this.lastAt < 35) return false;
    try {
      if (!this.attempted) {
        this.attempted = true;
        this.performer = this.load();
      }
      if (!this.performer) return false;
      this.lastAt = at;
      return this.performer(pattern as HapticPattern);
    } catch {
      this.performer = undefined;
      // Unsupported hardware/platform services are a silent no-op.
      return false;
    }
  }
}
