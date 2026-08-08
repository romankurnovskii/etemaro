import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './packages/core/src/shared/constants.js';

// Write a valid user-config.json for tests by copying from example
const configDir = path.join(REPO_ROOT, 'config');
const examplePath = path.join(configDir, 'user-config.example.json');
const userPath = path.join(configDir, 'user-config.json');

if (fs.existsSync(examplePath)) {
  fs.copyFileSync(examplePath, userPath);
}

// Set required env vars for env.* references in config (before config imports)
process.env.WALLET_PRIVATE_KEY = 'test_wallet_key_for_testing';
process.env.LLM_BASE_URL = 'https://api.test.com';
process.env.LLM_API_KEY = 'test_llm_key';
process.env.LLM_MODEL = 'test/model';
process.env.HIVEMIND_API_KEY = 'test_hivemind_key';
process.env.AGENT_MERIDIAN_API_URL = 'https://api.test.com/api';
process.env.PUBLIC_API_KEY = 'test_public_key';
process.env.PNL_RPC_URL = 'https://rpc.test.com';
process.env.JUPITER_API_KEY = 'test_jupiter_key';
process.env.JUPITER_REFERRAL_ACCOUNT = 'test_referral_account';
process.env.JUPITER_REFERRAL_FEE_BPS = '50';
process.env.TELEGRAM_CHAT_ID = 'test_telegram_chat_id';
process.env.DEFAULT_AGENT_MERIDIAN_PUBLIC_KEY = 'bWVyaWRpYW4taXMtdGhlLWJlc3QtYWdlbnRz';
