/**
 * @file provider.ts
 * @description EIP-1193 Web3 provider injected into the page context.
 * 
 * Creates the window.ethereum object that dApps use to interact with the wallet.
 * Implements the standard EIP-1193 provider interface plus legacy methods for
 * backward compatibility with older dApps.
 * 
 * @responsibilities
 * - Provide window.ethereum object for dApp detection
 * - Implement EIP-1193 request() method for RPC calls
 * - Support legacy send() and sendAsync() methods
 * - Emit provider events (accountsChanged, chainChanged, connect)
 * - Track selected account and chain ID state
 * - Announce via EIP-6963 for modern dApp discovery
 * 
 * @eip-compliance
 * - EIP-1193: Ethereum Provider JavaScript API
 * - EIP-6963: Multi Injected Provider Discovery
 * 
 * @example
 * ```javascript
 * // dApp usage:
 * const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
 * const chainId = await window.ethereum.request({ method: 'eth_chainId' });
 * 
 * window.ethereum.on('accountsChanged', (accounts) => {
 *   console.log('Accounts changed:', accounts);
 * });
 * ```
 */

// ============================================================================
// Security: Cache page origin for secure postMessage
// ============================================================================

/**
 * Cache the page origin at load time for secure postMessage calls.
 * This prevents origin spoofing attacks.
 */
const PAGE_ORIGIN = window.location.origin;

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * EIP-1193 request arguments structure.
 */
interface RequestArguments {
  /** JSON-RPC method name */
  method: string;
  /** Optional method parameters */
  params?: unknown[] | object;
}

// ============================================================================
// SimpleWalletProvider Class
// ============================================================================

/**
 * EIP-1193 compliant Ethereum provider.
 * Injected as window.ethereum for dApp compatibility.
 */
class SimpleWalletProvider {
  /** Identifies this provider as Simple Wallet */
  public isSimpleWallet = true;
  
  /** MetaMask compatibility flag - helps with dApp detection */
  public isMetaMask = true;
  
  /** Currently selected account address (null if not connected) */
  public selectedAddress: string | null = null;
  
  /** Current chain ID in hex format (e.g., '0x1' for mainnet) */
  public chainId: string | null = null;
  
  /** Auto-incrementing request ID for tracking responses */
  private requestId = 0;
  
  /** Map of pending request IDs to their resolve/reject callbacks */
  private pendingRequests = new Map<number, { resolve: Function; reject: Function }>();

  /**
   * Initializes the provider and sets up message listeners.
   * Listens for responses and events from the content script.
   */
  constructor() {
    // Listen for responses from content script
    window.addEventListener('message', (event) => {
      // Security: Only accept messages from same window and origin
      if (event.source !== window) return;
      if (event.origin !== PAGE_ORIGIN) return;

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

  // ============================================================================
  // EIP-1193 Methods
  // ============================================================================

  /**
   * Main EIP-1193 request method for JSON-RPC calls.
   * All wallet interactions go through this method.
   * 
   * @param args - Request arguments with method and optional params
   * @returns Promise resolving to the RPC response
   * @throws Error if request times out (60s) or is rejected
   * 
   * @example
   * ```javascript
   * const balance = await provider.request({
   *   method: 'eth_getBalance',
   *   params: ['0x...', 'latest']
   * });
   * ```
   */
  async request(args: RequestArguments): Promise<any> {
    const id = ++this.requestId;

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      // Send request to content script
      // Security: Use specific origin instead of wildcard
      window.postMessage({
        type: 'SIMPLE_WALLET_PROVIDER_REQUEST',
        id,
        method: args.method,
        params: args.params || []
      }, PAGE_ORIGIN);

      // Timeout after 60 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 60000);
    });
  }

  // ============================================================================
  // Legacy Method Support
  // ============================================================================

  /**
   * Legacy send method for older dApps.
   * @deprecated Use request() instead
   */
  async send(method: string, params?: any[]): Promise<any> {
    return this.request({ method, params });
  }

  /**
   * Legacy sendAsync method with callback pattern.
   * Used by some older Web3.js versions.
   * @deprecated Use request() instead
   */
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

  // ============================================================================
  // Response Processing
  // ============================================================================

  /**
   * Processes and normalizes results from the background script.
   * Extracts relevant data and updates local state as needed.
   * 
   * @param result - Raw result from background script
   * @returns Processed result suitable for dApp consumption
   * @private
   */
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

  // ============================================================================
  // Event Emitter Methods
  // ============================================================================

  /** Internal storage for event listeners */
  private listeners = new Map<string, Function[]>();

  /**
   * Registers an event listener.
   * 
   * @param event - Event name: 'accountsChanged', 'chainChanged', 'connect', 'disconnect'
   * @param listener - Callback function for the event
   * @returns this for chaining
   */
  on(event: string, listener: Function): this {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(listener);
    return this;
  }

  /**
   * Removes an event listener.
   * 
   * @param event - Event name
   * @param listener - Previously registered callback
   * @returns this for chaining
   */
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

  /**
   * Emits an event to all registered listeners.
   * 
   * @param event - Event name
   * @param args - Arguments to pass to listeners
   */
  emit(event: string, ...args: any[]): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      eventListeners.forEach(listener => listener(...args));
    }
  }
}

// ============================================================================
// Provider Installation
// ============================================================================

/**
 * Injects the provider as window.ethereum if not already present.
 * Announces via EIP-6963 for modern dApp discovery.
 */
if (!window.ethereum) {
  const provider = new SimpleWalletProvider();
  
  // Make window.ethereum read-only to prevent overwriting
  Object.defineProperty(window, 'ethereum', {
    value: provider,
    writable: false,
    configurable: false
  });

  // Legacy event for provider detection
  window.dispatchEvent(new Event('ethereum#initialized'));

  /**
   * EIP-6963 provider discovery.
   * Allows dApps to discover multiple wallet providers.
   */
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

// ============================================================================
// TypeScript Global Declarations
// ============================================================================

/**
 * Extends the global Window interface to include ethereum provider.
 * Required for TypeScript to recognize window.ethereum.
 */
declare global {
  interface Window {
    ethereum?: SimpleWalletProvider;
  }
}

export {};
