import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolate tests from the real user home and the repo config. These env vars must be set
// BEFORE any @etemaro/core import (path constants capture them at import time).
const testEtemaroHome = path.join(os.tmpdir(), `etemaro-vitest-${process.pid}`);
fs.mkdirSync(testEtemaroHome, { recursive: true });
process.env.ETEMARO_HOME = testEtemaroHome;

const testConfigPath = path.join(testEtemaroHome, 'config', 'agent-config.json');
fs.mkdirSync(path.dirname(testConfigPath), { recursive: true });
process.env.AGENT_CONFIG_PATH = testConfigPath;

// Required env vars for env.* references in config.
process.env.RPC_URL = 'https://test-rpc.solana.com';
process.env.PNL_RPC_URL = 'https://rpc.test.com';
process.env.LLM_BASE_URL = 'https://api.test.com';
process.env.LLM_API_KEY = 'test_llm_key';
process.env.LLM_MODEL = 'test/model';
process.env.HIVEMIND_API_KEY = 'test_hivemind_key';
process.env.AGENT_MERIDIAN_API_URL = 'https://api.test.com/api';
process.env.AGENT_MERIDIAN_PUBLIC_API_KEY = 'test_public_key';
process.env.JUPITER_API_KEY = 'test_jupiter_key';
process.env.JUPITER_REFERRAL_ACCOUNT = 'test_referral_account';
process.env.JUPITER_REFERRAL_FEE_BPS = '50';
process.env.TELEGRAM_CHAT_ID = 'test_telegram_chat_id';
process.env.DEFAULT_AGENT_MERIDIAN_PUBLIC_KEY = 'bWVyaWRpYW4taXMtdGhlLWJlc3QtYWdlbnRz';

// Write the default user config to the temp path (source of truth: defaultUserConfig.ts).
// Deferred import so it is loaded after the env vars above are in place.
const { defaultAgentConfigStr } = await import('./packages/core/src/config/defaultAgentConfig.js');
if (!fs.existsSync(testConfigPath)) {
  fs.writeFileSync(testConfigPath, `${defaultAgentConfigStr}\n`, 'utf8');
}
