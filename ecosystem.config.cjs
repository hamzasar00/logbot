module.exports = {
  apps: [
    {
      name: 'logbot',
      script: './src/index.js',
      cwd: __dirname,
      watch: false,
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 20,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
