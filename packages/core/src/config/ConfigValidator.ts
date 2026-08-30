/**
 * @file ConfigValidator.ts
 * @description Zod schema based validator for runtime application configuration files (Version 3).
 *
 * @features
 * - Uses nested Zod schema mapping directly to config shape
 * - Validates types, env refs, and thresholds using Zod
 * - Does not perform backward-compatible auto-migration from flattened configs
 *
 */

import fs from 'node:fs';
import path from 'node:path';
import { configPath, USER_CONFIG_PATH } from '../shared/constants.js';
import { defaultUserConfigStr } from './defaultUserConfig.js';
import { UserConfigSchema, ValidatedUserConfig } from './schema.js';

function getConfigFileName(): string {
  return path.basename(USER_CONFIG_PATH);
}

export function isHelpOrInfoCommand(): boolean {
  return (
    process.env.ETEMARO_SKIP_ENV_VALIDATION === '1' ||
    process.argv.some((a) => ['help', '--help', '-h', '--version', '-v', 'init', 'generate-wallet', 'new-wallet', 'wallet'].includes(a))
  );
}

export function loadAndValidateConfig(): ValidatedUserConfig {
  const isExplicitConfig = Boolean(process.env.USER_CONFIG_PATH?.trim());

  // Ensure user config directory and file exist
  if (!fs.existsSync(USER_CONFIG_PATH)) {
    if (isExplicitConfig) {
      if (isHelpOrInfoCommand()) {
        return JSON.parse(defaultUserConfigStr);
      }
      throw new Error(`Configuration file not found at "${USER_CONFIG_PATH}"`);
    }
    console.log(`[config] ${getConfigFileName()} not found, initializing from default config`);
    fs.mkdirSync(path.dirname(USER_CONFIG_PATH), { recursive: true });
    fs.writeFileSync(USER_CONFIG_PATH, defaultUserConfigStr + '\n', 'utf8');
  }

  // Read user config
  let raw: Record<string, unknown>;
  try {
    const content = fs.readFileSync(USER_CONFIG_PATH, 'utf8');
    if (!content.trim()) {
      if (isExplicitConfig) {
        throw new Error(`Configuration file is empty: "${USER_CONFIG_PATH}"`);
      }
      fs.writeFileSync(USER_CONFIG_PATH, defaultUserConfigStr + '\n', 'utf8');
      raw = JSON.parse(defaultUserConfigStr);
    } else {
      raw = JSON.parse(content);
    }
  } catch (e) {
    throw new Error(`Failed to parse ${getConfigFileName()}: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
  }

  // If running info commands, we can bypass strict parsing
  if (isHelpOrInfoCommand()) {
    return raw as unknown as ValidatedUserConfig; // Bypass validation
  }

  // Validate with Zod
  const result = UserConfigSchema.safeParse(raw);

  if (!result.success) {
    const issues = result.error?.issues ?? (result.error as any)?.errors ?? [];
    const errorMessages = issues.map((err: any) => `  - ${err.path.join('.')}: ${err.message}`).join('\n');
    throw new Error(
      `${getConfigFileName()} has invalid or missing fields:\n${errorMessages}\n\n` + `Please ensure you are using the Version 3 schema structure.`,
    );
  }

  return result.data;
}
