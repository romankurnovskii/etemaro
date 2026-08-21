const path = require('path');
const dotenv = require('dotenv');

const repoRoot = path.resolve(__dirname, '..');
// Load .env file from repo root if present
dotenv.config({ path: path.join(repoRoot, '.env') });

module.exports = {
  apps: [
    {
      name: 'etemaro',
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
        NODE_ENV: process.env.NODE_ENV || 'production',
        ...(process.env.WALLET_PRIVATE_KEY ? { WALLET_PRIVATE_KEY: process.env.WALLET_PRIVATE_KEY } : {}),
        ...(process.env.ETEMARO_DATA_DIR ? { ETEMARO_DATA_DIR: process.env.ETEMARO_DATA_DIR } : {}),
      },
    },
    /* Example Multi-Agent Setup:
    {
      name: 'agent-conservative',
      script: path.join(repoRoot, 'packages/daemon/src/Daemon.ts'),
      node_args: '--import tsx',
      cwd: repoRoot,
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      restart_delay: 5000,
      kill_timeout: 10000,
      env: {
        NODE_ENV: 'production',
        USER_CONFIG_PATH: 'config/agt_conservative.json',
        WALLET_PRIVATE_KEY: 'your_private_key_base58_for_agent_1',
      },
    },
    */
  ],
};
