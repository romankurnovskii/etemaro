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

function isHelpOrInfoCommand(): boolean {
  return (
    process.env.ETEMARO_SKIP_ENV_VALIDATION === '1' ||
    process.argv.some((a) => ['help', '--help', '-h', '--version', '-v', 'init', 'generate-wallet', 'new-wallet', 'wallet'].includes(a))
  );
}

export function loadAndValidateConfig(): ValidatedUserConfig {
  const EXAMPLE_CONFIG_PATH = configPath('templates/user-config.example.json');

  // Create example config if it doesn't exist
  if (!fs.existsSync(EXAMPLE_CONFIG_PATH)) {
    fs.mkdirSync(path.dirname(EXAMPLE_CONFIG_PATH), { recursive: true });
    fs.writeFileSync(EXAMPLE_CONFIG_PATH, defaultUserConfigStr, 'utf8');
  }

  // Handle test environment initial copying
  if (process.env.TEST_MODE || process.env.VITEST) {
    if (!fs.existsSync(USER_CONFIG_PATH) && fs.existsSync(EXAMPLE_CONFIG_PATH)) {
      fs.copyFileSync(EXAMPLE_CONFIG_PATH, USER_CONFIG_PATH);
    }
  }

  // Ensure user config exists
  if (!fs.existsSync(USER_CONFIG_PATH)) {
    if (fs.existsSync(EXAMPLE_CONFIG_PATH)) {
      console.log(`[config] ${getConfigFileName()} not found, copying from example`);
      fs.copyFileSync(EXAMPLE_CONFIG_PATH, USER_CONFIG_PATH);
    } else {
      throw new Error(`${getConfigFileName()} not found and no example config to copy from`);
    }
  }

  // Read user config
  let raw: Record<string, unknown>;
  try {
    const content = fs.readFileSync(USER_CONFIG_PATH, 'utf8');
    if (!content.trim() && fs.existsSync(EXAMPLE_CONFIG_PATH)) {
      fs.copyFileSync(EXAMPLE_CONFIG_PATH, USER_CONFIG_PATH);
      raw = JSON.parse(fs.readFileSync(EXAMPLE_CONFIG_PATH, 'utf8'));
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
