/**
 * ADR-008: Hot-Reloadable Configuration
 *
 * Re-exports for clean imports from the config module.
 */
export {
  HotConfigLoader,
  seedHotConfig,
  mergeAliasOverrides,
  KNOWN_MODEL_CAPABILITIES,
  type HotConfig,
  type ModelCapabilities,
  type HotConfigLoaderOptions,
} from './hot-config'
