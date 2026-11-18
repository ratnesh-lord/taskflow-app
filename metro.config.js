// Metro bundler settings.
//
// On the web, expo-sqlite runs as WebAssembly in a worker, so .wasm files must
// be treated as assets. The app only uses expo-sqlite's async functions, which
// do not need a cross-origin isolated page; its sync functions would.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('wasm');

module.exports = config;
