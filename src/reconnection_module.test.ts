import { describe, it, expect, vi } from 'vitest';
import { ReconnectionManager } from './reconnection_module';

describe('ReconnectionManager', () => {
  it('starts in connected state', () => {
    const manager = new ReconnectionManager();
    expect(manager.getState()).toBe('connected');
  });

  it('attempts reconnection and succeeds on first try', async () => {
    const connectFn = vi.fn().mockResolvedValue(undefined);
    const onReconnected = vi.fn();

    const manager = new ReconnectionManager({ baseDelayMs: 10, onReconnected });
    await manager.handleDisconnect(connectFn);
    expect(connectFn).toHaveBeenCalledTimes(1);
    expect(manager.getState()).toBe('connected');
    expect(onReconnected).toHaveBeenCalled();
  });

  it('retries until success', async () => {
    const connectFn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce(undefined);

    const manager = new ReconnectionManager({
      baseDelayMs: 10,
      maxRetries: 3,
    });
    await manager.handleDisconnect(connectFn);
    expect(connectFn).toHaveBeenCalledTimes(3);
    expect(manager.getState()).toBe('connected');
  });

  it('gives up after max retries and calls onExhausted', async () => {
    const onExhausted = vi.fn();
    const manager = new ReconnectionManager({
      baseDelayMs: 10,
      maxRetries: 2,
      onExhausted,
    });
    const connectFn = vi.fn().mockRejectedValue(new Error('fail'));

    await manager.handleDisconnect(connectFn);
    expect(connectFn).toHaveBeenCalledTimes(2);
    expect(manager.getState()).toBe('disconnected');
    expect(onExhausted).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('exhausted') })
    );
  });

  it('does not start duplicate reconnection loops', async () => {
    const manager = new ReconnectionManager({ baseDelayMs: 10 });
    const connectFn = vi.fn().mockImplementation(
      () => new Promise<void>((resolve) => setTimeout(resolve, 20))
    );

    manager.handleDisconnect(connectFn);
    manager.handleDisconnect(connectFn);
    await new Promise((r) => setTimeout(r, 50));
    expect(manager.getState()).toBe('connected');
    expect(connectFn.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('aborts pending attempts on destroy', async () => {
    const manager = new ReconnectionManager({ baseDelayMs: 1000 });
    const connectFn = vi.fn();

    manager.handleDisconnect(connectFn);
    manager.destroy();
    expect(manager.getState()).toBe('disconnected');
  });
});
