/**
 * Atom: atom-005
 * Automated Network Connection Reestablishment Test
 * Validates the system can automatically reestablish a network connection after a failure.
 */

import { EventEmitter } from 'events';

// ---------------------------------------------------------------------------
// System under test (SUT) contract — replace with actual import when available
// ---------------------------------------------------------------------------
interface ConnectionState {
  readonly status: 'connected' | 'disconnected' | 'reconnecting' | 'failed';
  readonly attempts: number;
}

interface ReconnectableNetworkConnection {
  connect(): Promise<void>;
  disconnect(): void;
  getState(): ConnectionState;
  on(event: 'connected', handler: () => void): this;
  on(event: 'disconnected', handler: () => void): this;
  on(event: 'reconnecting', handler: (attempt: number) => void): this;
  on(event: 'error', handler: (err: Error) => void): this;
  off(event: string, handler: (...args: any[]) => void): this;
}

interface StubConnectionOptions {
  readonly maxAttempts?: number;
  readonly delayMs?: number;
  readonly failAfterBudget?: boolean;
}

// ---------------------------------------------------------------------------
// Stand-in implementation for synthesis-time type checking and test execution.
// ---------------------------------------------------------------------------
class StubReconnectableConnection extends EventEmitter implements ReconnectableNetworkConnection {
  private _status: ConnectionState['status'] = 'disconnected';
  private _attempts = 0;
  private readonly _maxAttempts: number;
  private readonly _delayMs: number;
  private readonly _failAfterBudget: boolean;
  private _timer?: ReturnType<typeof setTimeout>;

  constructor(options?: StubConnectionOptions) {
    super();
    this._maxAttempts = options?.maxAttempts ?? 3;
    this._delayMs = options?.delayMs ?? 25;
    this._failAfterBudget = options?.failAfterBudget ?? false;
  }

  async connect(): Promise<void> {
    this._clear();
    this._attempts = 0;
    this._status = 'connected';
    this.emit('connected');
  }

  disconnect(): void {
    this._clear();
    this._status = 'disconnected';
    this.emit('disconnected');
    this._scheduleReconnect();
  }

  getState(): ConnectionState {
    return { status: this._status, attempts: this._attempts };
  }

  private _clear(): void {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = undefined;
    }
  }

  private _scheduleReconnect(): void {
    this._attempts += 1;
    this._status = 'reconnecting';
    this.emit('reconnecting', this._attempts);

    this._timer = setTimeout(() => {
      if (this._attempts >= this._maxAttempts) {
        if (this._failAfterBudget) {
          this._status = 'failed';
          this.emit('error', new Error('Reconnection budget exhausted'));
        } else {
          this._status = 'connected';
          this.emit('connected');
        }
        return;
      }

      this.emit('error', new Error(`Reconnection attempt ${this._attempts} failed`));
      this._scheduleReconnect();
    }, this._delayMs);
  }

  destroy(): void {
    this._clear();
    this.removeAllListeners();
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Automated Network Connection Reestablishment', () => {
  let sut: StubReconnectableConnection;

  beforeEach(() => {
    jest.useFakeTimers();
    sut = new StubReconnectableConnection();
  });

  afterEach(() => {
    sut.destroy();
    jest.useRealTimers();
  });

  it('transitions to reconnecting after an unexpected disconnect', async () => {
    const reconnectingPromise = new Promise<number>((resolve) => {
      sut.once('reconnecting', (attempt: number) => resolve(attempt));
    });

    await sut.connect();
    sut.disconnect();

    const attempt = await reconnectingPromise;
    expect(attempt).toBe(1);
    expect(sut.getState().status).toBe('reconnecting');
  });

  it('eventually reestablishes the connection within the configured retry budget', async () => {
    const states: Array<ConnectionState['status']> = [];

    sut.on('reconnecting', () => states.push('reconnecting'));
    sut.on('connected', () => states.push('connected'));

    await sut.connect();
    expect(sut.getState().status).toBe('connected');

    sut.disconnect();
    jest.advanceTimersByTime(75); // 3 attempts * 25ms

    expect(sut.getState().status).toBe('connected');
    expect(sut.getState().attempts).toBe(3);
    expect(states).toEqual([
      'connected',
      'reconnecting',
      'reconnecting',
      'reconnecting',
      'connected',
    ]);
  });

  it('increments reconnect attempts on each retry', async () => {
    const attempts: number[] = [];

    sut.on('reconnecting', (a: number) => attempts.push(a));

    await sut.connect();
    sut.disconnect();
    jest.advanceTimersByTime(75);

    expect(attempts).toEqual([1, 2, 3]);
  });

  it('recovers from rapid disconnect/connect cycles', async () => {
    await sut.connect();
    expect(sut.getState().status).toBe('connected');

    sut.disconnect();
    expect(sut.getState().status).toBe('reconnecting');

    await sut.connect();
    expect(sut.getState().status).toBe('connected');
    expect(sut.getState().attempts).toBe(0);

    sut.disconnect();
    jest.advanceTimersByTime(75);
    expect(sut.getState().status).toBe('connected');
  });

  it('enters a final failed state when the retry budget is exhausted and recovery is impossible', async () => {
    const failedSut = new StubReconnectableConnection({
      maxAttempts: 3,
      failAfterBudget: true,
    });

    const errors: Error[] = [];
    let reconnectingCount = 0;

    failedSut.on('error', (err: Error) => errors.push(err));
    failedSut.on('reconnecting', () => {
      reconnectingCount++;
    });

    await failedSut.connect();
    failedSut.disconnect();
    jest.advanceTimersByTime(75);

    expect(failedSut.getState().status).toBe('failed');
    expect(failedSut.getState().attempts).toBe(3);
    expect(reconnectingCount).toBe(3);
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[errors.length - 1].message).toBe('Reconnection budget exhausted');

    failedSut.destroy();
  });

  it('tolerates null or undefined constructor options without crashing', () => {
    expect(() => new StubReconnectableConnection(undefined)).not.toThrow();
    expect(() => new StubReconnectableConnection(null as unknown as StubConnectionOptions)).not.toThrow();

    const c = new StubReconnectableConnection(undefined);
    expect(c.getState().status).toBe('disconnected');
    c.destroy();
  });

  it('emits explicit error events during failed reconnection attempts', async () => {
    const errors: Error[] = [];
    sut.on('error', (err: Error) => errors.push(err));

    await sut.connect();
    sut.disconnect();
    jest.advanceTimersByTime(75);

    expect(sut.getState().status).toBe('connected');
    expect(errors).toHaveLength(2);
    expect(errors[0].message).toContain('1 failed');
    expect(errors[1].message).toContain('2 failed');
  });
});
