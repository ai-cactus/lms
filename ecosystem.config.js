/**
 * PM2 Ecosystem Configuration
 *
 * Uses cluster mode for zero-downtime reloads on a 2-vCPU VM.
 * Both apps run as the `deploy` system user.
 *
 * Instances:
 *   - staging: 1 instance (saves RAM for production)
 *   - production: 2 instances (max for 2 vCPUs)
 *
 * Deploy scripts call `pm2 reload` (not restart) to achieve
 * zero-downtime rolling updates.
 */

module.exports = {
  apps: [
    {
      name: "lms-staging",
      script: "node_modules/.bin/next",
      args: "start",
      cwd: "/home/deploy/apps/lms-staging",
      exec_mode: "cluster",
      instances: 1,
      wait_ready: true,
      listen_timeout: 30000,
      kill_timeout: 10000,
      env: {
        NODE_ENV: "production",
        PORT: 3001,
      },
      error_file: "/home/deploy/logs/lms-staging-error.log",
      out_file: "/home/deploy/logs/lms-staging-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,
    },
    {
      name: "lms-production",
      script: "node_modules/.bin/next",
      args: "start",
      cwd: "/home/deploy/apps/lms-production",
      exec_mode: "cluster",
      // 2 instances for 2 vCPUs; adjust if VM is scaled up
      instances: 2,
      wait_ready: true,
      listen_timeout: 30000,
      kill_timeout: 10000,
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
      error_file: "/home/deploy/logs/lms-production-error.log",
      out_file: "/home/deploy/logs/lms-production-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,
    },
  ],
};
