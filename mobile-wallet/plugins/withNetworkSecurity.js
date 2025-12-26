const { withAndroidNetworkSecurityConfig, withInfoPlist, withDangerousMod, AndroidConfig } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// Domain list to allow (must be kept in sync or imported from shared policy if possible)
// Since this runs at build time in a different context, we might duplicate or read the JSON.
// For robustness, I will include the domains inline here, derived from the same source.
const ALLOWED_DOMAINS = [
    "ethereum-rpc.publicnode.com",
    "ethereum-sepolia-rpc.publicnode.com",
    "rpc.sepolia.org",
    "sepolia.gateway.tenderly.co",
    "mainnet.base.org",
    "arb1.arbitrum.io",
    "mainnet.optimism.io",
    "polygon-rpc.com",
    "api.avax.network",
    "bsc-dataseed.binance.org",
    "rpc.linea.build",
    "mainnet.helius-rpc.com",
    "solana-mainnet.rpc.extrnode.com",
    "rpc.ankr.com",
    "api.devnet.solana.com",
    "toncenter.com",
    "testnet.toncenter.com",
    "endpoints.omniatech.io",
    "xrplcluster.com",
    "s1.ripple.com",
    "s2.ripple.com",
    "s.altnet.rippletest.net",
    "mempool.space",
    "etherscan.io",
    "api.etherscan.io",
    "sepolia.etherscan.io",
    "api-sepolia.etherscan.io",
    "basescan.org",
    "api.basescan.org",
    "arbiscan.io",
    "api.arbiscan.io",
    "optimistic.etherscan.io",
    "api-optimistic.etherscan.io",
    "polygonscan.com",
    "api.polygonscan.com",
    "snowtrace.io",
    "api.snowtrace.io",
    "bscscan.com",
    "api.bscscan.com",
    "lineascan.build",
    "api.lineascan.build",
    "solscan.io",
    "api.solscan.io",
    "xrpscan.com",
    "api.xrpscan.com",
    "testnet.xrpscan.com",
    "tonscan.org",
    "api.tonscan.org",
    "testnet.tonscan.org",
    "api.coingecko.com",
    "pro-api.coingecko.com",
    "api.coinpaprika.com"
];

// Android: Network Security Config XML
const withAndroidSecurityConfigXML = (config) => {
    return withDangerousMod(config, [
        'android',
        async (config) => {
            const resDir = path.join(config.modRequest.platformProjectRoot, 'app/src/main/res/xml');
            if (!fs.existsSync(resDir)) {
                fs.mkdirSync(resDir, { recursive: true });
            }

            const domainEntries = ALLOWED_DOMAINS.map(domain =>
                // includeSubdomains="true" allows api.etherscan.io if etherscan.io is listed, 
                // but we have extensive lists. Let's be strict but practical.
                // We will default to includeSubdomains=true for these domains to cover sub-services.
                `        <domain includeSubdomains="true">${domain}</domain>`
            ).join('\n');

            const xmlContent = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <domain-config cleartextTrafficPermitted="false">
${domainEntries}
    </domain-config>
    <base-config cleartextTrafficPermitted="false" />
</network-security-config>
`;

            fs.writeFileSync(path.join(resDir, 'network_security_config.xml'), xmlContent);
            return config;
        },
    ]);
};

// Android: Link XML in AndroidManifest using withDangerousMod for reliability
const withAndroidManifestLinking = (config) => {
    return withDangerousMod(config, [
        'android.manifest',
        async (config) => {
            const manifestPath = path.join(config.modRequest.platformProjectRoot, 'app/src/main/AndroidManifest.xml');
            if (fs.existsSync(manifestPath)) {
                let manifestContent = fs.readFileSync(manifestPath, 'utf8');

                // Simple string injection to avoid complex XML parsing deps if possible, 
                // but checking if attribute exists is safer.
                // However, withDangerousMod gives us access to modResults if we use the specific mod.
                // But here we are using the 'android.manifest' modifier which usually passes specific data.
                // Actually, let's stick to the raw file edit via DangerousMod 'android' or just use the modResults from 'android.manifest' if accessible.

                // Better approach: Use the provided `modResults` which IS the parsed XML object when using 'android.manifest'
                // But standard withDangerousMod gives access to file system.
                // The 'android.manifest' mod in Expo usually provides the manifest object in `config.modResults`.
                // Let's rely on the standard `AndroidConfig` if it works, but since it failed, we go RAW.

                // We will use regex to inject the attribute if it's missing.
                if (!manifestContent.includes('android:networkSecurityConfig')) {
                    manifestContent = manifestContent.replace(
                        /<application/g,
                        '<application android:networkSecurityConfig="@xml/network_security_config"'
                    );
                    fs.writeFileSync(manifestPath, manifestContent);
                }
            }
            return config;
        },
    ]);
};

// iOS: Info.plist NSAppTransportSecurity
const withIosAppTransportSecurity = (config) => {
    return withInfoPlist(config, (config) => {
        const exceptionDomains = {};

        ALLOWED_DOMAINS.forEach(domain => {
            exceptionDomains[domain] = {
                NSIncludesSubdomains: true,
                NSExceptionAllowsInsecureHTTPLoads: false,
                NSExceptionRequiresForwardSecrecy: true,
            };
        });

        config.modResults.NSAppTransportSecurity = {
            NSAllowsArbitraryLoads: false, // Block everything by default
            NSExceptionDomains: exceptionDomains
        };

        return config;
    });
};

const withNetworkSecurity = (config) => {
    config = withAndroidSecurityConfigXML(config);
    config = withAndroidManifestLinking(config);
    config = withIosAppTransportSecurity(config);
    return config;
};

module.exports = withNetworkSecurity;
