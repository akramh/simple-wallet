// This script runs in the page context and provides the window.ethereum object
// It implements the EIP-1193 provider interface for dApp compatibility

interface RequestArguments {
  method: string;
  params?: unknown[] | object;
}

class SimpleWalletProvider {
  public isSimpleWallet = true;
  public isMetaMask = true; // Improve dApp compatibility checks
  public selectedAddress: string | null = null;
  public chainId: string | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, { resolve: Function; reject: Function }>();

  constructor() {
    // Listen for responses from content script
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;

      const { type, id, result, error, event: evt, data } = event.data;

      if (type === 'SIMPLE_WALLET_PROVIDER_RESPONSE') {
        const pending = this.pendingRequests.get(id);
        if (!pending) return;
        this.pendingRequests.delete(id);
        if (error) {
          pending.reject(new Error(error));
        } else {
          pending.resolve(this.processResult(result));
        }
      }

      if (type === 'SIMPLE_WALLET_PROVIDER_EVENT' && evt) {
        if (evt === 'accountsChanged') {
          this.selectedAddress = Array.isArray(data) && data.length ? data[0] : null;
        }
        if (evt === 'chainChanged') {
          this.chainId = data;
        }
        this.emit(evt, data);
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
    if (result.accounts) {
      const accounts = result.accounts;
      this.selectedAddress = Array.isArray(accounts) && accounts.length ? accounts[0] : null;
      this.emit('accountsChanged', accounts);
      return accounts;
    }
    if (result.chainId) {
      this.chainId = result.chainId;
      this.emit('chainChanged', result.chainId);
      return result.chainId;
    }
    if (result && typeof result === 'object') {
      if ('signature' in result && typeof (result as any).signature === 'string') return (result as any).signature;
      if ('result' in result && typeof (result as any).result === 'string') return (result as any).result;
      if (result.balance) return result.balance;
      if (Array.isArray(result)) return result;
      // Fallback: stringify to avoid [object Object] surfacing to dApps
      return JSON.stringify(result);
    }
    if (result?.balance) return result.balance;
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

   // EIP-6963 provider discovery
   const info = {
     uuid: 'simple-wallet-eip6963',
     name: 'Simple Wallet',
     icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>',
     rdns: 'simple.wallet'
   };
   const announce = () => {
     window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { info, provider } }));
   };
   window.addEventListener('eip6963:requestProvider', announce);
   announce();

  console.log('Simple Wallet provider injected');
}

// TypeScript declarations
declare global {
  interface Window {
    ethereum?: SimpleWalletProvider;
  }
}

export {};
