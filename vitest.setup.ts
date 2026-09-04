import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './packages/core/src/shared/constants.js';
import { defaultUserConfigStr } from './packages/core/src/config/defaultUserConfig.js';

// Write a valid user-config.json for tests using defaultUserConfigStr
const configDir = path.join(REPO_ROOT, 'config');
const userPath = path.join(configDir, 'user-config.json');

fs.mkdirSync(configDir, { recursive: true });
if (!fs.existsSync(userPath)) {
  fs.writeFileSync(userPath, defaultUserConfigStr + '\n', 'utf8');
}

// Set required env vars for env.* references in config (before config imports)
process.env.RPC_URL = 'https://test-rpc.solana.com';
process.env.PNL_RPC_URL = 'https://rpc.test.com';
process.env.LLM_BASE_URL = 'https://api.test.com';
process.env.LLM_API_KEY = 'test_llm_key';
process.env.LLM_MODEL = 'test/model';
process.env.HIVEMIND_API_KEY = 'test_hivemind_key';
process.env.AGENT_MERIDIAN_API_URL = 'https://api.test.com/api';
process.env.AGENT_MERIDIAN_PUBLIC_API_KEY = 'test_public_key';
process.env.PNL_RPC_URL = 'https://rpc.test.com';
process.env.JUPITER_API_KEY = 'test_jupiter_key';
process.env.JUPITER_REFERRAL_ACCOUNT = 'test_referral_account';
process.env.JUPITER_REFERRAL_FEE_BPS = '50';
process.env.TELEGRAM_CHAT_ID = 'test_telegram_chat_id';
process.env.DEFAULT_AGENT_MERIDIAN_PUBLIC_KEY = 'bWVyaWRpYW4taXMtdGhlLWJlc3QtYWdlbnRz';
