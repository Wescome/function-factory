import {
  NetworkConnectionMonitor,
  NetworkConnectionListener,
  createNetworkConnectionMonitor,
} from './network_module';

const mockFetch = jest.fn();
(globalThis as any).fetch = mockFetch;

describe('NetworkConnectionMonitor', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: true, status: 204, statusText: 'No Content' });
  });

  it('constructs with inferable status', () => {
    const monitor = new NetworkConnectionMonitor();
    expect(monitor.getStatus()).toMatch(/^(online|offline)$/);
    monitor.stop();
  });

  it('isOnline reflects getStatus', () => {
    const monitor = new NetworkConnectionMonitor();
    expect(monitor.isOnline()).toBe(monitor.getStatus() === 'online');
    monitor.stop();
  });

  it('allows adding and removing listeners', () => {
    const monitor = new NetworkConnectionMonitor();
    const listener: NetworkConnectionListener = { onStatusChange: () => {} };
    const unsubscribe = monitor.addListener(listener);
    expect(typeof unsubscribe).toBe('function');
    expect(() => monitor.removeListener(listener)).not.toThrow();
    monitor.stop();
  });

  it('is idempotent for start and stop lifecycle', () => {
    const monitor = new NetworkConnectionMonitor();
    expect(() => {
      monitor.start();
      monitor.start();
      monitor.stop();
      monitor.stop();
    }).not.toThrow();
  });

  it('does not duplicate event registrations across repeated starts', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 204 });

    const monitor = new NetworkConnectionMonitor({
      heartbeatIntervalMs: 10,
      requestTimeoutMs: 5000,
    });

    monitor.start();
    monitor.start();

    await new Promise((res) => setTimeout(res, 30));
    monitor.stop();

    expect(mockFetch.mock.calls.length).toBeLessThan(8);
  });

  it('detects offline when heartbeat fetch fails', async () => {
    mockFetch.mockRejectedValue(new Error('net::ERR_INTERNET_DISCONNECTED'));

    const monitor = new NetworkConnectionMonitor({
      heartbeatIntervalMs: 10,
      requestTimeoutMs: 5,
    });

    const changes: Array<'online' | 'offline'> = [];
    monitor.addListener({
      onStatusChange: (status) => changes.push(status),
    });

    monitor.start();
    await new Promise((res) => setTimeout(res, 50));
    monitor.stop();

    expect(changes).toContain('offline');
  });

  it('reflects online after successful heartbeat', async () => {
    const monitor = new NetworkConnectionMonitor({
      heartbeatIntervalMs: 10,
      requestTimeoutMs: 5000,
    });
    monitor.start();
    await new Promise((res) => setTimeout(res, 50));
    expect(monitor.isOnline()).toBe(true);
    monitor.stop();
  });

  it('factory function creates independent monitors', () => {
    const a = createNetworkConnectionMonitor();
    const b = createNetworkConnectionMonitor();
    expect(a).not.toBe(b);
    expect(typeof a.isOnline()).toBe('boolean');
    a.stop();
    b.stop();
  });
});
