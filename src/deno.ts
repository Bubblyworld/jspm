#!/usr/bin/env -S deno run --allow-all --no-check --unstable --importmap /home/guybedford/Projects/jspm/jspm.importmap
import './deps.ts';
import { cli } from './cli.ts';
export * from './api.ts';

// CLI
if (import.meta.main) {
  const [cmd, ...rawArgs] = Deno.args;
  const code = await cli(cmd, rawArgs);
  Deno.exit(code);
}
