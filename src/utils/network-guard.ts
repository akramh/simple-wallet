/**
 * @file network-guard.ts
 * @description Runtime interceptor for global network APIs.
 *
 * This module "monkey-patches" the global `fetch`, `XMLHttpRequest`, and `WebSocket`
 * constructors to enforce the centralized network policy. It MUST be imported and
 * applied at the very start of the application lifecycle.
 */

import { isAllowedUrl } from '../config/network-policy.js';

let isGuardActive = false;

/**
 * Applies the Network Guard, overwriting global network APIs.
 * Can be called multiple times safely (idempotent).
 */
export function applyNetworkGuard(): void {
    if (isGuardActive) return;

    // Safely acquire the global scope in any environment (Browser, Node, Worker)
    // We cast to 'any' to avoid fighting with TS about which environment we are in.
    const globalScope = (
        (typeof globalThis !== 'undefined' ? globalThis :
            (typeof global !== 'undefined' ? global :
                (typeof window !== 'undefined' ? window : self)))
    ) as any;

    const consoleError = console.error; // Capture console in case we wrap it later (unlikely but safe)

    // 1. Guard `fetch`
    if (globalScope.fetch) {
        const originalFetch = globalScope.fetch;
        globalScope.fetch = function (input: any, init?: any): Promise<any> {
            let url = '';

            if (typeof input === 'string') {
                url = input;
            } else if (input && typeof input.toString === 'function' && (input instanceof URL || typeof input.toString() === 'string')) {
                // Handle URL objects or string-like objects. 
                // Note: Request objects usually have a .url property, handled below.
                // But some polyfills might just be stringifiable.
                url = input.toString();
            }

            if (input && typeof input === 'object' && 'url' in input) {
                // Handle Request objects
                url = input.url;
            }

            // If we extracted a URL, check it. If not, we might be in a weird state, 
            // but usually input is string or Request.
            // If url is still empty/null, originalFetch might throw, which is fine.
            if (url && !isAllowedUrl(url)) {
                const errorMsg = `[Security] Blocked outbound connection to unauthorized domain: ${url}`;
                consoleError(errorMsg);
                return Promise.reject(new Error(errorMsg));
            }

            return originalFetch.call(this, input, init);
        };
    }

    // 2. Guard `XMLHttpRequest`
    // We check existence because Node.js doesn't have XHR by default (unless polyfilled).
    if (typeof globalScope.XMLHttpRequest !== 'undefined') {
        const OriginalXHR = globalScope.XMLHttpRequest;

        // Create a proxy class rather than extending directly to avoid strict type issues
        const GuardedXHR = function () {
            const xhr = new OriginalXHR();
            const originalOpen = xhr.open;

            // Override open to check URL
            xhr.open = function (method: string, url: string | URL, ...args: any[]) {
                const urlString = url.toString();
                if (!isAllowedUrl(urlString)) {
                    const errorMsg = `[Security] Blocked outbound XHR to unauthorized domain: ${urlString}`;
                    consoleError(errorMsg);
                    throw new Error(errorMsg);
                }
                return originalOpen.call(this, method, url, ...args);
            }

            return xhr;
        };

        // Copy static properties if any (like OPEN, DONE constants)
        // This is crucial for libraries that check XMLHttpRequest.DONE
        Object.assign(GuardedXHR, OriginalXHR);

        // Ensure prototype chain is correct enough for instanceof checks if libraries rely on that
        // strictly speaking `new GuardedXHR() instanceof OriginalXHR` might fail with this proxy approach
        // unless we set the prototype.
        GuardedXHR.prototype = OriginalXHR.prototype;

        globalScope.XMLHttpRequest = GuardedXHR;
    }

    // 3. Guard `WebSocket`
    if (typeof globalScope.WebSocket !== 'undefined') {
        const OriginalWebSocket = globalScope.WebSocket;

        const GuardedWebSocket = function (url: string | URL, ...args: any[]) {
            const urlString = url.toString();
            if (!isAllowedUrl(urlString)) {
                const errorMsg = `[Security] Blocked outbound WebSocket to unauthorized domain: ${urlString}`;
                consoleError(errorMsg);
                throw new Error(errorMsg);
            }
            return new OriginalWebSocket(url, ...args);
        };

        Object.assign(GuardedWebSocket, OriginalWebSocket);
        GuardedWebSocket.prototype = OriginalWebSocket.prototype;
        globalScope.WebSocket = GuardedWebSocket;
    }

    isGuardActive = true;
    console.log('[Security] Network Guard activated. Egress is now restricted.');
}
