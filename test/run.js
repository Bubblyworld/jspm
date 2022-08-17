const JSPM_CLI = Deno.env.get('JSPM_CLI');

export const CLI_ARGS = JSPM_CLI ? [JSPM_CLI] : ['deno', 'run', '--no-check', '-A', '--unstable', 'src/jspm.js'];
