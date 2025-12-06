/**
 * @file injected.ts
 * @description Content script that bridges page context and extension context.
 * 
 * This script runs in an isolated content script context and handles communication
 * between the injected Web3 provider (provider.ts) running in the page context
 * and the background service worker.
 * 
 * @responsibilities
 * - Inject provider.ts script into the page's DOM
 * - Relay messages from page to background service worker
 * - Forward provider events from background to page
 * - Map JSON-RPC method names to internal message types
 * 
 * @message-flow
 * ```
 * dApp → window.ethereum.request()
 *      → provider.ts (page context, postMessage)
 *      → injected.ts (content script, chrome.runtime.sendMessage)
 *      → service-worker.ts (background)
 *      → response flows back through same path
 * ```
 * 
 * @security
 * - Validates message source (same window only)
 * - Filters for our specific message types
 * - Uses chrome.runtime for secure extension communication
 */

// ============================================================================
// Provider Script Injection
// ============================================================================

/**
 * Injects the Web3 provider script into the page context.
 * The provider script creates window.ethereum for dApp compatibility.
 * Script is removed from DOM after injection to keep the page clean.
 */
const script = document.createElement('script');
script.src = chrome.runtime.getURL('content/provider.js');
script.onload = function() {
  // Remove script element after execution (provider persists in memory)
  if (script.parentNode) {
    script.parentNode.removeChild(script);
  }
};
(document.head || document.documentElement).appendChild(script);

// ============================================================================
// Page → Background Message Relay
// ============================================================================

/**
 * Listens for messages from the injected provider in the page context.
 * Forwards wallet requests to the background service worker.
 */
window.addEventListener('message', async (event) => {
  // Security: Only accept messages from the same window
  if (event.source !== window) return;

  const { type, id, method, params } = event.data;

  // Only handle our provider messages
  if (type !== 'SIMPLE_WALLET_PROVIDER_REQUEST') return;

  try {
    // Forward request to background script
    const mapped = mapMethodToBackgroundType(method);
    if (mapped === 'UNKNOWN_METHOD') {
      window.postMessage({ type: 'SIMPLE_WALLET_PROVIDER_RESPONSE', id, result: null, error: 'Method not supported' }, '*');
      return;
    }

    const response = await chrome.runtime.sendMessage({
      type: mapped,
      payload: { method, params, origin: window.location.origin }
    });

    window.postMessage({
      type: 'SIMPLE_WALLET_PROVIDER_RESPONSE',
      id,
      result: response,
      error: null
    }, '*');
  } catch (error: any) {
    // Send error back to page
    window.postMessage({
      type: 'SIMPLE_WALLET_PROVIDER_RESPONSE',
      id,
      result: null,
      error: error.message
    }, '*');
  }
});

// ============================================================================
// Background → Page Event Relay
// ============================================================================

/**
 * Forwards provider events from background to the page provider.
 * Events include: accountsChanged, chainChanged, connect, disconnect.
 */
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'PROVIDER_EVENT') {
    window.postMessage({
      type: 'SIMPLE_WALLET_PROVIDER_EVENT',
      event: message.event,
      data: message.data
    }, '*');
  }
});

// ============================================================================
// JSON-RPC Method Mapping
// ============================================================================

/**
 * Maps standard JSON-RPC method names to internal message types.
 * Unmapped methods are routed to GENERIC_RPC for direct provider passthrough.
 * 
 * @param method - JSON-RPC method name (e.g., 'eth_accounts')
 * @returns Internal message type (e.g., 'ETH_ACCOUNTS')
 */
function mapMethodToBackgroundType(method: string): string {
  const methodMap: Record<string, string> = {
    'eth_accounts': 'ETH_ACCOUNTS',
    'eth_requestAccounts': 'ETH_REQUEST_ACCOUNTS',
    'eth_chainId': 'ETH_CHAIN_ID',
    'net_version': 'ETH_NET_VERSION',
    'eth_sendTransaction': 'ETH_SEND_TRANSACTION',
    'personal_sign': 'PERSONAL_SIGN',
    'eth_sign': 'ETH_SIGN',
    'eth_signTypedData': 'ETH_SIGN_TYPED_DATA',
    'eth_signTypedData_v4': 'ETH_SIGN_TYPED_DATA_V4',
    'personal_ecRecover': 'PERSONAL_EC_RECOVER',
    'wallet_switchEthereumChain': 'WALLET_SWITCH_CHAIN',
    'wallet_addEthereumChain': 'WALLET_ADD_CHAIN'
  };

  return methodMap[method] || 'GENERIC_RPC';
}

console.log('Simple Wallet content script loaded');
