const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

const repoRoot = path.resolve(__dirname, '..');

// ─── Instances ──────────────────────────────────────────────────
// Add one entry per agent. The exported `apps` array is generated from this
// list, so this is the only place to add, remove, or reconfigure agents.
//
// Each instance loads ALL of its runtime env (wallet key/passphrase, RPC, API
// keys, ...) from its own `envFile`, so instances stay isolated — different
// wallets and different endpoints per agent. Nothing is inherited from a
// shared repo .env.
//
//   name    – PM2 process name (required, must be unique)
//   config  – repo-relative or absolute path to the agent JSON config (required)
//   envFile – repo-relative .env holding this instance's secrets (required)
//   dataDir – optional data root (defaults to <repoRoot>/data)
//   env     – optional extra env vars for this instance (highest precedence)
const instances = [
  {
    name: 'bot-etemaro-01',
    config: './config/instances/agent-default.json',
    envFile: './.env',
  },
  // Example: a second agent on its own config, wallet, and data root.
  // {
  //   name: 'agent-conservative',
  //   config: './config/instances/agent-config.conservative.json',
  //   envFile: './.env.agent-conservative',
  //   dataDir: './data-agent-conservative',
  // },
];

const buildApp = (instance) => {
  if (!instance.envFile) {
    throw new Error(`[ecosystem] "${instance.name}": envFile is required`);
  }
  const envPath = path.resolve(repoRoot, instance.envFile);
  if (!fs.existsSync(envPath)) {
    throw new Error(`[ecosystem] "${instance.name}": envFile not found: ${instance.envFile}`);
  }

  return {
    name: instance.name,
    script: path.join(repoRoot, 'packages/daemon/src/Daemon.ts'),
    node_args: '--import tsx',
    cwd: repoRoot,
    interpreter: 'node',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    restart_delay: 5000,
    kill_timeout: 10000,
    max_restarts: 10,
    min_uptime: '10s',
    merge_logs: true,
    time: true,
    // Always start via this file (npm run pm2:start) so cwd + script path stay pinned to the repo.
    env: {
      ...dotenv.parse(fs.readFileSync(envPath)),
      AGENT_CONFIG_PATH: path.resolve(repoRoot, instance.config),
      ...(instance.dataDir ? { ETEMARO_DATA_DIR: path.resolve(repoRoot, instance.dataDir) } : {}),
      ...(instance.env || {}),
    },
  };
};

module.exports = {
  apps: instances.map(buildApp),
};
