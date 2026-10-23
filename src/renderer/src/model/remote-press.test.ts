import { afterEach, describe, expect, it, vi } from 'vitest';
import { RemotePressGesture } from './remote-press';

afterEach(() => vi.useRealTimers());
describe('Apple TV held commands', () => {
  it('sends a short click once and a held press once without a trailing short click', () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const gesture = new RemotePressGesture(send);
    gesture.start('select');
    vi.advanceTimersByTime(100);
    gesture.end('select');
    gesture.press('select');
    expect(send.mock.calls).toEqual([['select', false]]);
    gesture.start('home');
    vi.advanceTimersByTime(550);
    expect(send.mock.calls).toEqual([
      ['select', false],
      ['home', true],
    ]);
    vi.advanceTimersByTime(10000);
    gesture.end('home');
    gesture.press('home');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('cancels a pending hold on focus loss or unmount and accepts the next gesture', () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const gesture = new RemotePressGesture(send);
    gesture.start('up');
    vi.advanceTimersByTime(300);
    gesture.cancel();
    vi.advanceTimersByTime(1000);
    gesture.press('up');
    expect(send).not.toHaveBeenCalled();
    gesture.start('right');
    gesture.end('right');
    gesture.press('right');
    expect(send.mock.calls).toEqual([['right', false]]);
  });

  it('does not retain an old timer when switching to another key', () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const gesture = new RemotePressGesture(send);
    gesture.start('left');
    vi.advanceTimersByTime(400);
    gesture.start('down');
    vi.advanceTimersByTime(200);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(350);
    expect(send.mock.calls).toEqual([['down', true]]);
    gesture.cancel();
    vi.advanceTimersByTime(1000);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
