// Metro bundler settings.
//
// On the web, expo-sqlite runs as WebAssembly in a worker and needs:
//   - .wasm files treated as assets;
//   - a cross-origin isolated page (these two headers), for SharedArrayBuffer.
// The headers here cover `expo start --web`; a deployed web build must send
// the same two headers (see scripts/e2e/serve-dist.mjs).
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('wasm');
config.server = {
  ...config.server,
  enhanceMiddleware: (middleware) => (req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    return middleware(req, res, next);
  },
};

module.exports = config;
