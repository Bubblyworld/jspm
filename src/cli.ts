#!/usr/bin/env -S deno run --allow-all --no-check --unstable --importmap /home/guybedford/Projects/jspm/jspm.deno.importmap
import './deps.ts';
import chalk from 'chalk';
import { JspmError } from "./common/err.ts";
import { version } from "./version.ts";
import { startSpinnerLog } from "./cli/spinner.ts";
import { fromCamelCase, readFlags } from "./cli/flags.ts";
import type { TraceMapOptions } from "./tracemap/tracemap.ts";
import process from 'process';
import { indent, printFrame, indentGraph } from './cli/format.ts';
import { writeFileSync, readFileSync } from 'fs';

export async function cli (cmd: string | undefined, rawArgs: string[]): Promise<number> {
  let spinner;

  if (cmd && rawArgs.length === 1 && (rawArgs[0] === '--help' || rawArgs[0] === '-h')) {
    rawArgs = [cmd];
    cmd = 'help';
  }

  if (cmd && rawArgs.indexOf('--offline') !== -1 || rawArgs.indexOf('-z') !== -1) {
    rawArgs.splice(rawArgs.findIndex(flag => flag === '--offline' || flag === '-z'), 1);
    const { setOffline } = await import('./install/resolver.ts');
    setOffline(true);
  }

  let log: string | boolean = false;
  if (cmd && rawArgs.some(arg => arg === '--log' || arg.startsWith('--log='))) {
    const index = rawArgs.findIndex(arg => arg === '--log' || arg.startsWith('--log='));
    if (rawArgs[index].length > 5) {
      log = rawArgs[index].slice(6);
    }
    else {
      log = true;
    }
    rawArgs.splice(index, 1);
  }

  try {
    switch (cmd) {
      case 'add': {
        const { args, opts } = readFlags(rawArgs, {
          boolFlags: ['log', 'dev', 'peer', 'optional'],
          strFlags: ['log']
        });
        spinner = await startSpinnerLog(log);
        spinner.text = `Adding ${args.join(', ').slice(0, process.stdout.columns - 21)}...`;
        const { add } = await import('./cmd/add.ts');
        if (opts.dev)
          opts.saveDev = true;
        else if (opts.peer)
          opts.savePeer = true;
        else if (opts.optional)
          opts.saveOptional = true;
        else
          opts.save = true;
        const { changed, installed } = await add(args, opts as TraceMapOptions);
        spinner.stop();
        if (changed)
          ok(`Installed ${installed.join(', ')}.`);
        else
          ok('Already installed.');
        break;
      }

      case 'cc': {
        if (rawArgs.length)
          throw new JspmError(`jspm cc does not take any arguments.`);

        console.log(`${chalk.bold.yellow('warm')} TODO: jspm cache clear currently unimplemented.`);
      }

      case 'deno': {
        const execArgIndex = rawArgs.findIndex(x => x[0] !== '-');
        if (execArgIndex === -1)
          throw new JspmError(`Expected a module to execute.`);

        // Deno flags inlined because we merge in jspm flag handling here
        const { opts } = readFlags(rawArgs.slice(0, execArgIndex), {
          boolFlags: ['log', 'allow-all', 'allow-env', 'allow-hrtime', 'allow-net', 'allow-plugin',
              'allow-read', 'allow-run', 'allow-write', 'cached-only', 'lock-write', 'quiet', 'watch', 'check', 'production', 'install'],
          strFlags: ['log', 'allow-net', 'allow-read', 'allow-write', 'inspect', 'inspect-brk',
              'log-level', 'reload', 'seed', 'v8-flags'],
          aliases: { 'A': 'allow-all', 'c': 'config', 'L': 'log-level', 'q': 'quiet', 'r': 'reload' }
        });

        opts.env = ['deno', 'node'];
        if (opts.production)
          opts.env.push('production');
        else
          opts.env.push('development');

        const denoFlags: string[] = [];
        for (const flag of Object.keys(opts)) {
          if (flag === 'log')
            continue;
          if (typeof opts[flag] === 'boolean')
            denoFlags.push('--' + fromCamelCase(flag));
          if (typeof opts[flag] === 'string')
            denoFlags.push('--' + fromCamelCase(flag) + '=' + opts[flag]);
        }
        const { deno } = await import('./cmd/deno.ts');
        const code = await deno(rawArgs[execArgIndex], denoFlags, rawArgs.slice(execArgIndex + 1));
        return code;
      }

      case 'help': {
        const { args, opts } = readFlags(rawArgs);
        if (args.length > 1)
          throw new JspmError(`jspm help only takes a single command, try "jspm help ${args[0]}".`);
        if (args.length === 0)
          console.log(usage());
        else
          console.log(cmdHelp(args[0]));
        break;
      }

      case 'link': {
        const { args, opts } = readFlags(rawArgs, {
          boolFlags: ['log', 'browser', 'production', 'node'],
          strFlags: ['log', 'out'],
          arrFlags: ['env'],
          aliases: { 'o': 'out', 'b': 'browser', 'p': 'production' }
        });

        opts.env = [...opts.env as string[] || [], ...opts.browser ? ['browser'] : opts.node ? ['node'] : ['deno', 'node']];

        if (opts.production)
          opts.env.push('production');
        else
          opts.env.push('development');

        spinner = await startSpinnerLog(log);
        spinner.text = `Linking for ${opts.env.join(', ')}...`;
        const { link } = await import('./cmd/link.ts');
        let { changed, map } = await link(args, opts as TraceMapOptions);
        const output = map.toString();
        if (opts.out === undefined) {
          spinner.stop();
          console.log(output);
          break;
        }
        let existingMap;
        try {
          existingMap = readFileSync(opts.out).toString();
        }
        catch {}
        if (existingMap !== output) {
          writeFileSync(opts.out, output);
          ok(`${changed ? 'Lockfile updated. ' : ''}Import map written to ${opts.out}.`);
        }
        else {
          ok(`${changed ? 'Lockfile updated. ' : ''}Import map at ${opts.out} unchanged.`);
        }
        break;
      }

      case 'ls':
        try {
          const { args, opts } = readFlags(rawArgs);
          
          if (!args.length)
            throw new JspmError('No module path provided to list');
          if (args.length > 1)
            throw new JspmError('Only one module must be passed to list');

          const { list } = await import ('./cmd/list.ts');
          const { resolved, exports } = await list(args[0]);

          console.log(resolved);
          const padding = Math.min(Math.max(<number>Object.keys(exports).map(key => key.length).sort((a, b) => a > b ? 1 : -1).pop() + 2, 20), 80);
          for (const key of Object.keys(exports)) {
            const value = exports[key];
            if (typeof value === 'string') {
              console.log(key + value.padStart(padding - key.length + value.length, ' '));
            }
            else if (value !== null) {
              let depth = 0;
              function logNestedObj (obj: Record<string, any>): string[] {
                depth += 2;
                const curDepth = depth;
                const lines: string[] = [];
                for (const key of Object.keys(obj)) {
                  const value = obj[key];
                  if (typeof value === 'string') {
                    lines.push(chalk.black.bold(key) + value.padStart(padding - key.length + value.length - curDepth, ' '));
                  }
                  else {
                    lines.push(key);
                    for (const line of logNestedObj(value))
                      lines.push(line);
                  }
                }
                return indentGraph(lines);
              }
              console.log(key + '\n' + logNestedObj(value).join('\n'));
            }
          }
        }
        catch (e) {
          if (typeof e === 'string')
            throw `${chalk.bold.red('err')}  ${e}`;
          throw e;
        }
        break;    

      case 'rem': {
        const { args } = readFlags(rawArgs);
        const { rem } = await import('./cmd/rem.ts');
        const changed = await rem(args);
        if (changed)
          ok(`Removed ${args.join(', ')}.`);
        else
          ok(`No package.json dependencies found to remove.`);
        break;
      }

      case 'run': {

      }

      case 'version':
        console.log(`jspm/${version}`);
        break;

      default:
        console.error((cmd ? ' ' + chalk.red(`Unknown command ${cmd}\n`) : '') + usage());
    }
  }
  catch (e) {
    if (spinner) spinner.stop();
    if (e instanceof JspmError)
      console.error(`${chalk.bold.red('err')}  ${indent(e.message, '     ')}`);
    else
      throw e;
  }
  return 0;

  function ok (msg: string) {
    console.log(`${chalk.bold.green('ok')}   ${msg}`);
  }
}

function cmdHelp (cmd: string) {
  if (!help[cmd]) {
    // TODO: levenstein suggestion
    return chalk.red(`Unknown command ${chalk.bold(cmd)}\n`) + usage();
  }
  const [, description, detail] = help[cmd];
  return '\n  ' + description + '\n' + (detail ? detail + '\n' : '');
}

function cmdList (cmds: string[], doubleSpace = false) {
  const list: string[] = [];
  let maxCmdLen = 0;
  for (const cmd of cmds) {
    const [command] = help[cmd];
    maxCmdLen = Math.max(command.length, maxCmdLen);
  }
  for (const cmd of cmds) {
    const [command, description] = help[cmd];
    list.push(command.padEnd(maxCmdLen + 2, ' ') + description + (doubleSpace ? '\n' : ''));
  }
  return '\n    ' + list.join('\n    ');
}

const highlightCommands = ['add', 'link', 'deno', 'help'];

function usage () {
  const header = `
  > https://jspm.org/cli#v${version} ▪ ES Module Package Management
  
  ${chalk.italic('Package import map workflows from Deno to the browser.')}\n
  ${chalk.bold('Primary Commands:')}
`;

  return header + cmdList(highlightCommands, true) + `
  ${chalk.bold('Command List:\n') + cmdList(Object.keys(help).filter(x => !highlightCommands.includes(x)))}\n
  Run "jspm help <cmd>" for help on a specific command.
`;
}

const help: Record<string, [string, string] | [string, string, string]> = {
  'add': [
    'jspm add <package target>+',
    'Add a package to the package.json dependencies', `
    jspm add <package target>+
    
    Options:
        --dev                 Add to devDependencies
        --peer                Add to peerDependencies
    -u, --update              If there is an existing lock resolution for this
                              dependency or any of its transitive dependencies,
                              ensure they are updated to their latest versions.

  In addition, the full dependency graph is resolved and stored in the
  local jspm.lock lockfile, which is created if it does not exist.

  ${chalk.bold('Supported Targets:')}

    <package target> = [registry]<name>[version] | <URL Target>

    Registry
      npm:                    npm registry (default)
      nest:                   nest.land
      deno:                   deno.land
  
    Version
      (none)                  Latest stable version
      @                       Latest unstable version of a package
      @X                      Latest patch on major version
      @X.Y                    Latest patch on major and minor version
      @X.Y.Z                  Exact package version
      @TAG                    Custom tag

    URL Target
      ./local/folder          Local file: URL install
      https://www.site.com/x  Direct URL install

  ${chalk.bold('Example:')}

    package.json file before add:
  
    ${indent(printFrame(JSON.stringify({ dependencies: {}}, null, 2)), '    ')}
    
    $ jspm add react@16

    package.json file after add:

    ${indent(printFrame(JSON.stringify({ dependencies: { react: '^16.0' }}, null, 2)), '    ')}
    `
  ],

  'cc': [
    'jspm cc',
    'Clear the jspm local URL cache', `
      jspm cc

      ${chalk.bold('Note: This feature is currently unimplemented and supports is pending.')}

      Clears the jspm version cache.

      When running under Deno, clears all jspm CDN URLs from the Deno cache.
      When running under Node.js, clears all jspm CDN permacache URLs from the
      custom fetch cache.
    `
  ],

  'deno': [
    'jspm deno <module>',
    'Execute "deno run" with jspm linking', `
    jspm deno [Deno run options] <module> [Deno run args]

    Options:
    -p, --production          Use "production" conditional module resolutions
                              (defaults to "development").
    -i, --install             Run a full install for any missing dependencies.

    All Deno run options should be supported. See "deno help run".

    Internally, the module is first linked via "jspm link <module>" in order to
    automaticaly construct a temporary import map to provide to Deno run.

    See "jspm help link" for more information on jspm just-in-time linking.

  ${chalk.bold('Example:')}
    
    app.ts:
    ${indent(printFrame(`import figlet from 'figlet';\n\nconsole.log(figlet.textSync('jspm is awesome')));`), '    ')}

    $ jspm deno app.ts
    > Yay
  `
  ],

  'help': [
    'jspm help [<cmd>]',
    'Help on jspm commands', `
    jspm help <cmd>            GetH on a specific command
    jspm help --commands/-c    List all commands`
  ],

  'link': [
    'jspm link [module]+',
    'Link a module for execution', `
    jspm link [module]+

    Traces the given modules and links them using the lockfile dependency
    resolutions, outputting the corresponding import map for the subgraph.

    The default link environment is "browser", "development".

    To fully link for all possibly dependency imports, use "jspm link"
    without any module arguments.

    Optionss
    -d, --deno                Resolve modules for the "deno" environment.
    -p, --production          Resolve modules the "production" environment
                              (defaults to "development").
        --node                Resolve modules for the "node" environment.
        [--env=custom]+       Resolve modules for custom environment names.

    For more information on how module resolution works and the way conditional
    environment resolution applies, see the JSPM module resolution guide at
    https://jspm.org/cli/resolution`
  ],

  'ls': [
    'jspm ls <package target>',
    'List the exports of a package', `
    jspm ls <package target>[/subpath]

    Resolves the package target to an exact version, and lists the "exports"
    field exported subpaths and resolutions for a package, optionally filtered
    to specific exports subpaths.

    For more information on the package "exports" field, see
    https://jspm.org/cli#package-exports.

  ${chalk.bold('Example:')}

    $ jspm ls preact@10/compat

    > npm:preact@10.5.7
    > ./compat
    > ├╴browser           ./compat/dist/compat.module.js
    > ├╴umd               ./compat/dist/compat.umd.js
    > ├╴require           ./compat/dist/compat.js
    > └╴import            ./compat/dist/compat.mjs
    > ./compat/server
    > └╴require           ./compat/server.js
    `
  ],

  'rem': [
    'jspm rem <pkg>',
    'Remove a given package from the package.json file', `
    jspm rem <pkg>+

  ${chalk.bold('Example:')}
   
    package.json file before removal:
    
    ${indent(printFrame(JSON.stringify({ dependencies: { react: '^16.0' }}, null, 2)), '    ')}
     
    package.json file after running "jspm rem react":
     
    ${indent(printFrame(JSON.stringify({ dependencies: {}}, null, 2)), '    ')}`
  ],

  'run': [
    'jspm run <script>',
    'Run a package.json script', `
    jspm run <script>

    ${chalk.bold('Note: This feature is currently unimplemented and supports is pending.')}`
  ],

  'version': [
    'jspm version',
    'Print the current jspm version'
  ],
};

if (import.meta.main) {
  const [cmd, ...rawArgs] = Deno.args;
  const code = await cli(cmd, rawArgs);
  Deno.exit(code);
}
