#!/usr/bin/env node

// CLI
if (require.main === module) {
  import('./cli').then(async ({ cli }) => {
    const [, , cmd, ...rawArgs] = process.argv;
    const code = await cli(cmd, rawArgs);
    process.exit(code);
  });
}
// API
else {
  module.exports = require('./api');
}
