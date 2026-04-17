
import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { applyNetworkGuard } from '../../src/utils/network-guard';

describe('Network Egress Security', () => {

    // Define mocks directly in scope
    let originalFetch = global.fetch;

    before(() => {
        // Mock global.fetch if not present (Node environment might vary)
        if (!global.fetch) {
            global.fetch = async () => new Response();
        }

        // Mock XHR and WebSocket for Node environment
        const globalAny = global as any;
        if (!globalAny.XMLHttpRequest) {
            class MockXHR {
                open(method: string, url: string) { }
            }
            globalAny.XMLHttpRequest = MockXHR;
        }
        if (!globalAny.WebSocket) {
            class MockWebSocket {
                constructor(url: string) { }
            }
            globalAny.WebSocket = MockWebSocket;
        }

        // Apply the guard (it will wrap our mocks or the real things)
        applyNetworkGuard();
    });

    it('should block unauthorized HTTP requests (fetch)', async () => {
        const forbiddenUrl = 'https://google.com';

        await assert.rejects(
            async () => {
                await fetch(forbiddenUrl);
            },
            (err: any) => {
                assert.match(err.message, /\[Security\] Blocked outbound connection/);
                return true;
            }
        );
    });

    it('should block unauthorized HTTP requests (XMLHttpRequest)', () => {
        const forbiddenUrl = 'https://evil-analytics.io/track';
        const globalAny = global as any;
        const xhr = new globalAny.XMLHttpRequest();

        assert.throws(
            () => {
                xhr.open('GET', forbiddenUrl);
            },
            (err: any) => {
                assert.match(err.message, /\[Security\] Blocked outbound XHR/);
                return true;
            }
        );
    });

    it('should block unauthorized WebSocket connections', () => {
        const forbiddenUrl = 'wss://echo.websocket.org';
        const globalAny = global as any;

        assert.throws(
            () => {
                new globalAny.WebSocket(forbiddenUrl);
            },
            (err: any) => {
                assert.match(err.message, /\[Security\] Blocked outbound WebSocket/);
                return true;
            }
        );
    });

    it('should ALLOW chrome-extension resources', async () => {
        // This simulates a local resource fetch
        const extensionUrl = 'chrome-extension://abcdefghijklmnop/config.json';

        try {
            await fetch(extensionUrl);
        } catch (err: any) {
            // In Node.js environment, 'fetch' doesn't support chrome-extension:// scheme
            // and throws "unknown scheme". This is GOOD because it means the NetworkGuard
            // ALLOWED the request to pass through to the native fetch.
            // If the Guard blocked it, we would see "Blocked outbound connection".
            if (err.message && err.message.includes('[Security] Blocked')) {
                assert.fail('NetworkGuard incorrectly BLOCKED a chrome-extension URL');
            }
            // Any other error means the Guard allowed it.
        }
    });

    it('should ALLOW authorized HTTP requests', async () => {
        const allowedUrl = 'https://ethereum-rpc.publicnode.com';

        try {
            await fetch(allowedUrl);
        } catch (err: any) {
            // If it's the security error, fail the test
            if (err.message && err.message.includes('[Security] Blocked')) {
                assert.fail(`Authorized URL ${allowedUrl} was blocked by security guard`);
            }
            // Other errors (network connectivity in test env) are expected and acceptable
            // as long as it's not the guard blocking it.
        }
    });

    it('should ALLOW all Alchemy chain hostnames used by the wallet', async () => {
        const alchemyHosts = [
            'https://eth-mainnet.g.alchemy.com/v2/fake-key',
            'https://eth-sepolia.g.alchemy.com/v2/fake-key',
            'https://base-mainnet.g.alchemy.com/v2/fake-key',
            'https://polygon-mainnet.g.alchemy.com/v2/fake-key',
            'https://arb-mainnet.g.alchemy.com/v2/fake-key',
            'https://opt-mainnet.g.alchemy.com/v2/fake-key',
            'https://solana-mainnet.g.alchemy.com/v2/fake-key',
        ];
        for (const url of alchemyHosts) {
            try {
                await fetch(url);
            } catch (err: any) {
                if (err.message && err.message.includes('[Security] Blocked')) {
                    assert.fail(`Alchemy host ${url} was blocked by security guard`);
                }
            }
        }
    });

});
