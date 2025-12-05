// This script runs in the page context and provides the window.ethereum object
// It implements the EIP-1193 provider interface for dApp compatibility

interface RequestArguments {
  method: string;
  params?: unknown[] | object;
}

class SimpleWalletProvider {
  public isSimpleWallet = true;
  public isMetaMask = false; // Some dApps check for this
  private requestId = 0;
  private pendingRequests = new Map<number, { resolve: Function; reject: Function }>();

  constructor() {
    // Listen for responses from content script
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;

      const { type, id, result, error } = event.data;

      if (type !== 'SIMPLE_WALLET_PROVIDER_RESPONSE') return;

      const pending = this.pendingRequests.get(id);
      if (!pending) return;

      this.pendingRequests.delete(id);

      if (error) {
        pending.reject(new Error(error));
      } else {
        pending.resolve(this.processResult(result));
      }
    });
  }

  // Main request method (EIP-1193)
  async request(args: RequestArguments): Promise<any> {
    const id = ++this.requestId;

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      // Send request to content script
      window.postMessage({
        type: 'SIMPLE_WALLET_PROVIDER_REQUEST',
        id,
        method: args.method,
        params: args.params || []
      }, '*');

      // Timeout after 60 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 60000);
    });
  }

  // Legacy method support (for older dApps)
  async send(method: string, params?: any[]): Promise<any> {
    return this.request({ method, params });
  }

  async sendAsync(payload: any, callback: Function): Promise<void> {
    try {
      const result = await this.request({
        method: payload.method,
        params: payload.params
      });
      callback(null, { id: payload.id, jsonrpc: '2.0', result });
    } catch (error) {
      callback(error, null);
    }
  }

  // Process specific result types
  private processResult(result: any): any {
    if (result.accounts) return result.accounts;
    if (result.chainId) return result.chainId;
    if (result.balance) return result.balance;
    return result;
  }

  // Event emitter methods (simplified)
  private listeners = new Map<string, Function[]>();

  on(event: string, listener: Function): this {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(listener);
    return this;
  }

  removeListener(event: string, listener: Function): this {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      const index = eventListeners.indexOf(listener);
      if (index > -1) {
        eventListeners.splice(index, 1);
      }
    }
    return this;
  }

  emit(event: string, ...args: any[]): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      eventListeners.forEach(listener => listener(...args));
    }
  }
}

// Inject the provider into window.ethereum
if (!window.ethereum) {
  const provider = new SimpleWalletProvider();
  Object.defineProperty(window, 'ethereum', {
    value: provider,
    writable: false,
    configurable: false
  });

  // Announce provider to the page
  window.dispatchEvent(new Event('ethereum#initialized'));

  console.log('Simple Wallet provider injected');
}

// TypeScript declarations
declare global {
  interface Window {
    ethereum?: SimpleWalletProvider;
  }
}

export {};
