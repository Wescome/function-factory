/**
 * Type Export Configuration
 *
 * Settings governing how types are exported from the monorepo,
 * including output format, frequency, and destination paths.
 */

export interface TypeExportSettings {
  /** The format used when exporting types. */
  format: 'typescript-declarations' | 'json-schema' | 'openapi';

  /** How often type exports should be generated. */
  frequency: 'manual' | 'pre-commit' | 'ci' | 'watch';

  /** Directory where exported type artifacts are written. */
  outputDirectory: string;

  /** Whether to generate an index barrel file for exports. */
  generateIndex: boolean;

  /** Glob patterns for source files to include in type export. */
  include: string[];

  /** Glob patterns for source files to exclude from type export. */
  exclude: string[];
}

export const typeExportConfig: TypeExportSettings = {
  format: 'typescript-declarations',
  frequency: 'ci',
  outputDirectory: './dist/types',
  generateIndex: true,
  include: ['src/**/*.ts'],
  exclude: ['src/**/*.spec.ts', 'src/**/*.test.ts'],
} as const;

export default typeExportConfig;
