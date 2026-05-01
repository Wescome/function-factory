export type NetworkStatus = 'online' | 'offline';

export interface NetworkConnectionListener {
  onConnect?(): void;
  onDisconnect?(): void;
  onStatusChange?(status: NetworkStatus): void;
}

export interface NetworkConnectionMonitorOptions {
  /** URL used for active heartbeat checks in non-browser environments. */
  heartbeatUrl?: string;
  /** Interval between heartbeats in milliseconds. Default: 30000 */
  heartbeatIntervalMs?: number;
  /** Request timeout for each heartbeat in milliseconds. Default: 5000 */
  requestTimeoutMs?: number;
}

/**
 * Detects network connection failures by monitoring browser online/offline events
 * and performing periodic heartbeat probes elsewhere.
 */
export class NetworkConnectionMonitor {
  private status: NetworkStatus;
  private listeners = new Set<NetworkConnectionListener>();
  private heartbeatId: ReturnType<typeof setInterval> | null = null;
  private abortController: AbortController | null = null;
  private _running = false;

  private readonly heartbeatUrl: string;
  private readonly heartbeatIntervalMs: number;
  private readonly requestTimeoutMs: number;

  constructor(options: NetworkConnectionMonitorOptions = {}) {
    this.heartbeatUrl = options.heartbeatUrl ?? 'https://www.google.com/generate_204';
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 30000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 5000;
    this.status = this.inferInitialStatus();
  }

  private inferInitialStatus(): NetworkStatus {
    if (typeof navigator !== 'undefined' && 'onLine' in navigator) {
      return navigator.onLine ? 'online' : 'offline';
    }
    return 'online';
  }

  /** Begin monitoring the network connection. */
  start(): void {
    if (this._running) return;
    this._running = true;
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline);
      window.addEventListener('offline', this.handleOffline);
    } else {
      this.beginHeartbeat();
    }
  }

  /** Stop monitoring and release resources. */
  stop(): void {
    if (!this._running) return;
    this._running = false;
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline);
      window.removeEventListener('offline', this.handleOffline);
    }
    this.endHeartbeat();
  }

  /** Returns true when the network is considered online. */
  isOnline(): boolean {
    return this.status === 'online';
  }

  /** Returns the current network status. */
  getStatus(): NetworkStatus {
    return this.status;
  }

  /**
   * Register a listener. Returns an unsubscribe function.
   */
  addListener(listener: NetworkConnectionListener): () => void {
    this.listeners.add(listener);
    return () => this.removeListener(listener);
  }

  /** Remove a previously registered listener. */
  removeListener(listener: NetworkConnectionListener): void {
    this.listeners.delete(listener);
  }

  private setStatus(next: NetworkStatus): void {
    if (this.status === next) return;
    this.status = next;
    this.emit(next);
  }

  private emit(status: NetworkStatus): void {
    for (const listener of this.listeners) {
      try {
        listener.onStatusChange?.(status);
        if (status === 'online') listener.onConnect?.();
        if (status === 'offline') listener.onDisconnect?.();
      } catch {
        // Protect against misbehaving listeners.
      }
    }
  }

  private handleOnline = (): void => this.setStatus('online');
  private handleOffline = (): void => this.setStatus('offline');

  private beginHeartbeat(): void {
    this.endHeartbeat();
    this.heartbeatId = setInterval(() => {
      if (!this.abortController) this.ping();
    }, this.heartbeatIntervalMs);
    this.ping();
  }

  private endHeartbeat(): void {
    if (this.heartbeatId) {
      clearInterval(this.heartbeatId);
      this.heartbeatId = null;
    }
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  private async ping(): Promise<void> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      this.abortController = new AbortController();
      timeoutId = setTimeout(() => this.abortController?.abort(), this.requestTimeoutMs);
      const response = await fetch(this.heartbeatUrl, {
        method: 'HEAD',
        cache: 'no-store',
        signal: this.abortController.signal,
      });
      clearTimeout(timeoutId);
      this.setStatus(response.ok ? 'online' : 'offline');
    } catch {
      if (timeoutId) clearTimeout(timeoutId);
      this.setStatus('offline');
    } finally {
      this.abortController = null;
    }
  }
}

/** Factory function to create a new {@link NetworkConnectionMonitor}. */
export function createNetworkConnectionMonitor(
  options?: NetworkConnectionMonitorOptions,
): NetworkConnectionMonitor {
  return new NetworkConnectionMonitor(options);
}
