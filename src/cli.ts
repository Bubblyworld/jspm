#!/usr/bin/env -S deno run --allow-all --no-check --unstable --importmap /home/guybedford/Projects/jspm/jspm.importmap
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
import { urlToNiceStr } from './common/url.ts';

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
      case 'install': {
        const { args, opts } = readFlags(rawArgs, {
          boolFlags: ['log', 'dev', 'peer', 'optional', 'reset'],
          strFlags: ['log']
        });
        spinner = await startSpinnerLog(log);
        spinner.text = `Installing${args.length ? ' ' + args.join(', ').slice(0, process.stdout.columns - 21) : ''}...`;
        const { install } = await import('./cmd/install.ts');
        if (opts.dev)
          opts.saveDev = true;
        else if (opts.peer)
          opts.savePeer = true;
        else if (opts.optional)
          opts.saveOptional = true;
        else
          opts.save = true;
        const { changed, installed } = await install(args, opts as TraceMapOptions);
        spinner.stop();
        if (changed)
          ok(`Installed${installed.length ? ' ' + installed.join(', ') : ''}.`);
        else
          ok('Already installed.');
        break;
      }

      case 'cc': {
        if (rawArgs.length)
          throw new JspmError(`jspm cc does not take any arguments.`);

        console.log(`${chalk.bold.yellow('warm')} TODO: jspm cache clear currently unimplemented.`);
      }

      case 'checkout': {
        const { args } = readFlags(rawArgs);

        if (args.length !== 1)
          throw new JspmError(`A single package target must be provided to check out.`);

        const { checkout } = await import('./cmd/checkout.ts');
        spinner = await startSpinnerLog(log);
        spinner.text = `Checking out ${args[0].slice(0, process.stdout.columns - 21)}...`;
        const checkoutDir = await checkout(args[0]);
        spinner.stop();
        if (checkoutDir)
          ok(`Checked out ${args[0]} into ${urlToNiceStr(checkoutDir)}.`);
        else
          ok(`Already checked out.`);
        break;
      }

      case 'deno': {
        const execArgIndex = rawArgs.findIndex(x => x[0] !== '-');
        if (execArgIndex === -1)
          throw new JspmError(`Expected a module to execute.`);

        const jspmFlags = ['freeze-lock', 'no-lock', 'production', 'install'];

        // Deno flags inlined because we merge in jspm flag handling here
        const { opts, args } = readFlags(rawArgs.slice(0, execArgIndex), {
          boolFlags: ['log', 'allow-all', 'allow-env', 'allow-hrtime', 'allow-net', 'allow-plugin',
              'allow-read', 'allow-run', 'allow-write', 'cached-only', 'lock-write', 'quiet', 'watch', 'no-check', ...jspmFlags],
          strFlags: ['log', 'allow-net', 'allow-read', 'allow-write', 'inspect', 'inspect-brk',
              'log-level', 'reload', 'seed', 'v8-flags'],
          aliases: { 'A': 'allow-all', 'c': 'config', 'L': 'log-level', 'q': 'quiet', 'r': 'reload', 'x': 'freeze-lock', 'i': 'install' }
        });

        opts.env = ['deno', 'node'];
        if (opts.production)
          opts.env.push('production');
        else
          opts.env.push('development');

        const denoFlags: string[] = [];
        for (const flag of Object.keys(opts)) {
          const asSnakeCase = fromCamelCase(flag);
          if (jspmFlags.includes(asSnakeCase))
            continue;
          if (typeof opts[flag] === 'boolean')
            denoFlags.push('--' + asSnakeCase);
          if (typeof opts[flag] === 'string')
            denoFlags.push('--' + asSnakeCase + '=' + opts[flag]);
        }
        const { deno } = await import('./cmd/deno.ts');
        const code = await deno(rawArgs[execArgIndex], denoFlags, args, opts);
        return code;
      }

      case 'help': {
        const { args } = readFlags(rawArgs);
        if (args.length > 1)
          throw new JspmError(`jspm help only takes a single command, try "jspm help ${args[0]}".`);
        if (args.length === 0)
          console.log(usage());
        else
          console.log(cmdHelp(args[0]));
        break;
      }

      case 'init': {
        throw new JspmError('jspm init is a TODO');
      }

      case 'link': {
        const { args, opts } = readFlags(rawArgs, {
          boolFlags: ['log', 'browser', 'production', 'node', 'freeze-lock', 'no-lock'],
          strFlags: ['log', 'out'],
          arrFlags: ['env'],
          aliases: { 'o': 'out', 'b': 'browser', 'p': 'production', 'x': 'freeze-lock' }
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
        spinner.stop();
        const output = map.toString();
        if (opts.out === undefined) {
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

      case 'locate': {
        throw new JspmError('jspm locate is a TODO');
      }

      case 'ls': {
        const { args } = readFlags(rawArgs);
        
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
        break;
      }

      case 'uninstall': {
        const { args } = readFlags(rawArgs);
        const { uninstall } = await import('./cmd/uninstall.ts');

        spinner = await startSpinnerLog(log);
        spinner.text = 'Uninstalling ' + args.join(', ') + '...';
        const changed = await uninstall(args);
        spinner.stop();
        if (changed)
          ok(`Uninstalled ${args.join(', ')}.`);
        else
          ok(`No package.json dependencies found to remove.`);
        break;
      }

      case 'run': {
        throw new JspmError('jspm run is a TODO');
      }

      case 'update': {
        throw new JspmError('jspm update is a TODO');
      }

      case 'upgrade': {
        throw new JspmError('jspm upgrade is a TODO');
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
  let maxCmdLen = 30;
  for (const cmd of cmds) {
    const [command, description] = help[cmd];
    list.push(command.padEnd(maxCmdLen + 2, ' ') + description + (doubleSpace ? '\n' : ''));
  }
  return '\n    ' + list.join('\n    ');
}

const highlightCommands = ['install', 'link', 'deno', 'help'];

function usage () {
  const header = `
  > https://jspm.org/cli#v${version} ▪ ES Module Package Management
  
  ${chalk.italic('Package import map workflows from Deno to the browser.')}\n
  ${chalk.bold('Primary Commands:')}
`;

  return header + cmdList(highlightCommands, true) + `
  ${chalk.bold('Other Commands:\n') + cmdList(Object.keys(help).filter(x => !highlightCommands.includes(x)))}\n
  ${chalk.bold('Global Options:')}
     -z, --offline                  Attempt an offline operation using the cache
         --log[=<name>,<name>]      Output debug logs with optional filtering\n
  Run "jspm help <cmd>" for help on a specific command.
`;
}

const help: Record<string, [string, string] | [string, string, string]> = {
  'install': [
    'jspm install [package target]+',
    'Run a package or lock install', `
    jspm install [package target]+
    
  Options:
        --dev                 Add to devDependencies
        --peer                Add to peerDependencies
    -l, --latest              Ensure installed resolutions are to their latest
                              versions

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

    package.json file before install:
  
    ${indent(printFrame(JSON.stringify({ dependencies: {}}, null, 2)), '    ')}
    
    $ jspm install react@16

    package.json file after install:

    ${indent(printFrame(JSON.stringify({ dependencies: { react: '^16.0' }}, null, 2)), '    ')}
    `
  ],

  'cc': [
    'jspm cc',
    'Clear the jspm local URL cache', `
    jspm cc

  ${chalk.bold('Note: This feature is currently unimplemented and supports is pending.')}

  Clears the jspm version cache.

  * When running under Deno, clears all jspm CDN URLs from the Deno cache.
  * When running under Node.js, clears all jspm CDN permacache URLs from the
    custom fetch cache.
    `
  ],

  'checkout': [
    'jspm checkout <package target>',
    'Check out a dependency for local vendoring', `
    jspm checkout <package target>

    Downloads the given package target into the ./deps folder to allow local
    debugging and modification.

    To revert a checkout use "jspm install --reset".

  ${chalk.bold('Example:')}

    jspm.lock before checkout:

    ${indent(printFrame(`# Generated by jspm
[[package]]
url = "."

[package.deps]
es-module-lexer = "https://ga.jspm.io/npm:es-module-lexer@0.3.26"`), '    ')}

    $ jspm checkout es-module-lexer
    > Checked out es-module-lexer into ./deps/es-module-lexer.

    jspm.lock after checkout:

    ${indent(printFrame(`# Generated by jspm
[[package]]
url = "."

[package.deps]
es-module-lexer = "./deps/es-module-lexer"`), '    ')}

    Local modifications in deps/es-module-lexer can be made and will then
    reflect in the application.

    $ jspm install --reset
    > Ok  Installed.

    jspm.lock is reverted to the original state again.`
  ],

  'deno': [
    'jspm deno <module>',
    'Execute "deno run" with jspm linkage', `
    jspm deno [Deno run options] <module> [Deno run args]

  Options:
    -p, --production          Use "production" conditional module resolutions
                              (defaults to "development")
    -i, --install             Run a full install for any missing dependencies

  All Deno run options should be supported. See "deno help run".

  Internally, the module is first linked via "jspm link <module>" in order to
  automaticaly construct a temporary import map to provide to Deno run.

  See "jspm help link" for more information on jspm just-in-time linking.

  ${chalk.bold('Example:')}
    
    app.ts:

    ${indent(printFrame(`import figlet from 'figlet';\n\nconsole.log(figlet.textSync('jspm is awesome')));`), '    ')}

    $ jspm deno app.ts
    > Yay`
  ],

  'help': [
    'jspm help [cmd]',
    'Help on jspm commands', `
    jspm help <cmd>            Get help on a specific command`
  ],

  'init': [
    'jspm init [dir]',
    'Initialize a new jspm project', `
    jspm init [dir]
  
  ${chalk.bold('Note: This feature is currently unimplemented and supports is pending.')}`
  ],

  'link': [
    'jspm link [module]+',
    'Link a module for execution', `
    jspm link [module]+

  Traces the given modules and links them using the lockfile dependency
  resolutions, outputting the corresponding import map for the subgraph.

  Linking will use the local lockfile by default, including persisting
  any new resolutions to the lockfile, unless specified otherwise via the
  --freeze-lock or --no-lock flags.

  The default link environment is "browser", "development".

  To fully link for all possibly dependency imports, use "jspm link"
  without any module arguments.

  Options:
    -d, --deno                Resolve modules for the "deno" environment.
    -p, --production          Resolve modules the "production" environment
                              (defaults to "development").
        --node                Resolve modules for the "node" environment.
    -x  --freeze-lock         Do not make any changes to the lockfile.
        --no-lock             Ignore lockfile resolutions entirely.
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

  'uninstall': [
    'jspm uninstall <pkg>',
    'Remove a given package from the package.json', `
    jspm uninstall <pkg>+

  ${chalk.bold('Example:')}
   
    package.json file before removal:
    
    ${indent(printFrame(JSON.stringify({ dependencies: { react: '^16.0' }}, null, 2)), '    ')}
     
    package.json file after running "jspm uninstall react":
     
    ${indent(printFrame(JSON.stringify({ dependencies: {}}, null, 2)), '    ')}`
  ],

  'locate': [
    'jspm locate <package target>',
    'Locate the exact URL of a module or asset', `
    jspm locate <package target>

  ${chalk.bold('Note: This feature is currently unimplemented and supports is pending.')}`
  ],

  'run': [
    'jspm run <script>',
    'Run a package.json script', `
    jspm run <script>

  ${chalk.bold('Note: This feature is currently unimplemented and supports is pending.')}`
  ],

  'update': [
    'jspm update <package target>*',
    'Update a dependency', `
    jspm update <package target>*

  Updates the provided dependencies, by default runs a full update of all
  dependencies to their install ranges.  
    
  Optionally filters by specific packages and package ranges, and applying
  to all dependencies of those names and ranges in the install tree.

  If a package is not found, an error is thrown.

  To update packages through major / breaking changes, use upgrade instead.

  ${chalk.bold('Note: This feature is currently unimplemented and supports is pending.')}`
  ],

  'upgrade': [
    'jspm upgrade <name>*',
    'Upgrade a top-level dependency', `
    jspm upgrade <name>*

  Upgrades the package.json dependencies by bumping the major, minor or patch
  version, depending on whether the package.json dependency ranges are
  based on major, minor or patch ranges.

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
