// Content script that injects the Web3 provider into the page
// This runs in an isolated context and communicates with the page via window.postMessage

// Inject the provider script into the page context
const script = document.createElement('script');
script.src = chrome.runtime.getURL('content/provider.js');
script.onload = function() {
  // Remove script after injection
  if (script.parentNode) {
    script.parentNode.removeChild(script);
  }
};
(document.head || document.documentElement).appendChild(script);

// Listen for messages from the injected provider
window.addEventListener('message', async (event) => {
  // Only accept messages from the same window
  if (event.source !== window) return;

  const { type, id, method, params } = event.data;

  // Only handle our provider messages
  if (type !== 'SIMPLE_WALLET_PROVIDER_REQUEST') return;

  try {
    // Forward request to background script
    const response = await chrome.runtime.sendMessage({
      type: mapMethodToBackgroundType(method),
      payload: { method, params }
    });

    // Send response back to page
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

// Map JSON-RPC methods to background message types
function mapMethodToBackgroundType(method: string): string {
  const methodMap: Record<string, string> = {
    'eth_accounts': 'ETH_ACCOUNTS',
    'eth_requestAccounts': 'ETH_REQUEST_ACCOUNTS',
    'eth_chainId': 'ETH_CHAIN_ID',
    'eth_sendTransaction': 'ETH_SEND_TRANSACTION',
    'personal_sign': 'PERSONAL_SIGN',
    'eth_sign': 'ETH_SIGN',
    'eth_signTypedData': 'ETH_SIGN_TYPED_DATA',
    'eth_signTypedData_v4': 'ETH_SIGN_TYPED_DATA_V4',
    'wallet_switchEthereumChain': 'WALLET_SWITCH_CHAIN',
    'wallet_addEthereumChain': 'WALLET_ADD_CHAIN'
  };

  return methodMap[method] || 'UNKNOWN_METHOD';
}

console.log('Simple Wallet content script loaded');
