#!/usr/bin/env -S deno run --allow-all --no-check --unstable --importmap /home/guybedford/Projects/jspm/jspm.deno.importmap
import './deps.ts';
import chalk from 'chalk';
import { JspmError } from "./common/err.ts";
import { version } from "./version.ts";
import { startSpinnerLog } from "./cli/spinner.ts";
import { fromCamelCase, readFlags } from "./cli/flags.ts";
import { TraceMapOptions } from "./tracemap/tracemap.ts";
import process from 'process';
import { indent, printFrame } from './cli/format.ts';
import { writeFileSync, readFileSync } from 'fs';

export async function cli (cmd: string | undefined, rawArgs: string[]): Promise<number> {
  let spinner;

  if (cmd && rawArgs.length === 1 && (rawArgs[0] === '--help' || rawArgs[0] === '-h')) {
    rawArgs = [cmd];
    cmd = 'help';
  }

  try {
    switch (cmd) {
      case 'add': {
        const { args, opts } = readFlags(rawArgs, {
          boolFlags: ['log', 'dev', 'peer', 'optional'],
          strFlags: ['log']
        });
        spinner = await startSpinnerLog(opts.log as string | boolean);
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

        opts.env = ['node', 'browser', 'deno'];
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
        const { args, opts } = readFlags(rawArgs, {
          boolFlags: ['commands'],
          aliases: { c: 'commands' }
        });
        if (args.length > 1)
          throw new JspmError(`jspm help only takes a single command, try "jspm help ${args[0]}".`);
        if (args.length === 0) {
          console.log(usage(opts.commands as boolean | undefined));
        }
        else {
          if (opts.commands as boolean | undefined)
            throw new JspmError(`The --commands flag does not apply to specific command help. Try just "jspm help --commands".`);
          console.log(cmdHelp(args[0]));
        }
        break;
      }

      case 'link': {
        const { args, opts } = readFlags(rawArgs, {
          boolFlags: ['log', 'deno', 'production', 'node', 'install'],
          strFlags: ['log', 'out'],
          arrFlags: ['env'],
          aliases: { 'o': 'out', 'd': 'deno', 'p': 'production', 'i': 'install' }
        });

        opts.env = [...opts.env as string[] || [], ...opts.deno ? ['node', 'browser', 'deno'] : opts.node ? ['node'] : ['browser']];

        if (opts.production)
          opts.env.push('production');
        else
          opts.env.push('development');

        spinner = await startSpinnerLog(opts.log as string | boolean);
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

      case 'rem': {
        const { args } = readFlags(rawArgs, {});
        const { rem } = await import('./cmd/rem.ts');
        const changed = await rem(args);
        if (changed)
          ok(`Removed ${args.join(', ')}.`);
        else
          ok(`No package.json dependencies found to remove.`);
        break;
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
    return chalk.red(`Unknown command ${chalk.bold(cmd)}\n`) + usage(false);
  }
  const [, description, detail] = help[cmd];
  return '\n  ' + description + '\n' + (detail ? detail + '\n' : '');
}

function cmdList (cmds: string[]) {
  const list: string[] = [];
  let maxCmdLen = 0;
  for (const cmd of cmds) {
    const [command] = help[cmd];
    maxCmdLen = Math.max(command.length, maxCmdLen);
  }
  for (const cmd of cmds) {
    const [command, description] = help[cmd];
    list.push(command.padEnd(maxCmdLen + 2, ' ') + description + '\n');
  }
  return '\n    ' + list.join('\n    ');
}

function usage (fullList = false) {
  if (fullList)
    return '\n' + chalk.bold('  Command List:\n') + cmdList(Object.keys(help)) + `
  Run "jspm help <cmd>" for help on a specific command.
`;

  const header = `
  > https://jspm.org/cli#v${version} ▪ ES Module Package Management
  
  ${chalk.italic('Package import map workflows from Deno to the browser.')}
`;

  return header + cmdList(['add', 'link', 'deno', 'help']) + `
  Run "jspm help --commands" or "jspm help -c" for the full command list.
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
    
    > jspm add react@16

    package.json file after add:

    ${indent(printFrame(JSON.stringify({ dependencies: { react: '^16.0' }}, null, 2)), '    ')}
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
        --log[=<name>, ...]   Display link logs

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
    -i, --install             Auto install local dependencies into the
                              package.json that are found locally.
    -d, --deno                Resolve modules for the "deno" environment.
    -p, --production          Resolve modules the "production" environment
                              (defaults to "development").
        --node                Resolve modules for the "node" environment.
        [--env=custom]+       Resolve modules for custom environment names.
        --log[=<name>,...]    Display linkage logs

    For more information on how module resolution works and the way conditional
    environment resolution applies, see the JSPM module resolution guide at
    https://jspm.org/cli/resolution`
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
