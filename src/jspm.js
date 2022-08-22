import { Generator } from '@jspm/generator';
import { parse } from 'https://deno.land/std@0.119.0/flags/mod.ts';
import { version } from './version.js';

const flags = parse(Deno.args, {
  alias: {
    'o': 'output',
    'e': 'env',
    'm': 'map',
    'r': 'resolution'
  },
  boolean: ['force', 'stdout', 'preload', 'integrity', 'compact'],
  string: ['map', 'env', 'output', 'resolution'],
  default: {
    force: false
  },
});

const cmd = flags._[0];

async function getInputMap (flags) {
  let inMap = '{}';
  try {
    inMap = await Deno.readTextFile(flags.map || 'importmap.json');
  }
  catch (e) {
    if (flags.map)
      throw e;
    return {};
  }
  return JSON.parse(inMap);
}

function getOutputFile (flags) {
  
}

async function writeMap (map, flags, defaultStdout = false) {
  const output = JSON.stringify(map, null, 2);
  if (!flags.output && (defaultStdout || flags.stdout)) {
    console.log(output);
  }
  else {
    const outfile = flags.output || flags.map || 'importmap.json';
    if (!outfile.endsWith('.json') && !outfile.endsWith('.importmap')) {
      throw new JspmError(`Extract will only write to ".json" or ".importmap" files. Use "jspm inject" for HTML injection.`);
    }
    await Deno.writeTextFile(outfile, output);
    console.error(`%cOK: %cUpdated %c${outfile}`, 'color: green', 'color: black', 'font-weight: bold');
  }
}

class JspmError extends Error {
  jspmError = true;
}

function getResolutions (flags) {
  if (!flags.resolution) return;
  const resolutions = Array.isArray(flags.resolution) ? flags.resolution : [flags.resolution];
  return Object.fromEntries(resolutions.map(resolution => {
    if (resolution.indexOf('=') === -1)
      throw new JspmError('Resolutions must be mappings from aliases to targets, for example of the form "--resolution pkg=x.y.z"');
    return resolution.split('=');
  }));
}

function getEnv (flags, browser) {
  const env = ['development', 'deno', 'node'];
  const envFlags = Array.isArray(flags.env) ? flags.env : (flags.env || '').split(',').map(e => e.trim());
  if (browser && !envFlags.includes('browser') && !envFlags.includes('no-browser'))
    envFlags.push('browser');
  if (envFlags.includes('browser') && !envFlags.includes('no-module'))
    envFlags.push('module')
  for (const name of envFlags) {
    switch (name) {
      case 'no-deno':
      case 'no-module':
      case 'no-node':
      case 'no-browser':
        env.splice(env.indexOf(name.slice(2)), 1);
        break;
      case 'browser':
        env.splice(env.indexOf('deno'), 1);
        env.splice(env.indexOf('node'), 1);
        env.push('browser');
        break;
      case 'production':
        env.splice(env.indexOf('development'), 1);
        env.push('production');
        break;
      case 'node':
        env.splice(env.indexOf('deno'), 1);
        break;
      case 'deno':
      case 'development':
      case 'module':
        break;
      default:
        env.push(name);
        break;
    }
  }
  return env;
}

try {
  switch (cmd) {
    case 'i':
    case 'install': {
      const args = flags._.slice(1).map(arg => {
        if (arg.indexOf('=') === -1)
          return arg;
        const [alias, target] = arg.split('=');
        return { alias, target };
      });
      const generator = new Generator({
        inputMap: await getInputMap(flags),
        env: getEnv(flags),
        resolutions: getResolutions(flags),
      });
      console.error(`Installing${args.length ? ' ' + args.map(x => typeof x === 'string' ? x : x.alias).join(', ') : ''}...`);
      if (args.length)
        await generator.install(args);
      else
        await generator.reinstall();
      await writeMap(generator.getMap(), flags);
      break;
    }
    case 'update': {
      const args = flags._.slice(1);
      const generator = new Generator({
        inputMap: await getInputMap(flags),
        env: getEnv(flags),
        resolutions: getResolutions(flags)
      });
      console.error(`Updating${args.length ? ' ' + args.join(', ') : ''}...`);
      await generator.update(args);
      await writeMap(generator.getMap(), flags);
      break;
    }
    case 'uninstall': {
      const args = flags._.slice(1);
      const generator = new Generator({
        inputMap: await getInputMap(flags),
        env: getEnv(flags)
      });
      console.error(`Uninstalling ${args.join(', ')}...`);
      await generator.uninstall(args);
      await writeMap(generator.getMap(), flags);
      break;
    }
    case 'ti':
    case 'trace-install': {
      const args = flags._.slice(1);
      const generator = new Generator({
        inputMap: await getInputMap(flags),
        env: getEnv(flags),
        resolutions: getResolutions(flags),
      });
      console.error(`Tracing${args.length ? ' ' + args.map(x => typeof x === 'string' ? x : x.alias).join(', ') : ''}...`);
      if (!args.length)
        throw new JspmError(`Trace install requires at least one module to trace.`);
      await generator.traceInstall(args);
      await writeMap(generator.getMap(), flags);
      break;
    }
    case 'inject': {
      const args = flags._.slice(1);
      const generator = new Generator({
        inputMap: await getInputMap(flags),
        // HTML injection implies browser
        env: getEnv(flags, true),
        resolutions: getResolutions(flags)
      });

      if (args.length === 0)
        throw new JspmError('Inject requires an HTML file to inject into.');

      const htmlFile = args[args.length - 1];
      const modules = args.slice(0, -1);
      const trace = modules.length === 0;
      console.error(`Injecting ${modules.length ? modules.join(', ') + ' ' : ''}into ${htmlFile}...`);

      const html = await Deno.readTextFile(htmlFile);

      const output = await generator.htmlInject(html, {
        pins: modules,
        trace,
        htmlUrl: new URL(args[0], 'file:///' + Deno.cwd().replace(/\\/g, '/')).href,
        comment: false,
        preload: flags.preload,
        integrity: flags.integrity,
        whitespace: !flags.compact,
      });

      await Deno.writeTextFile(htmlFile, output);
      break;
    }
    case 'e':
    case 'extract': {
      const args = flags._.slice(1);
      const generator = new Generator({
        inputMap: await getInputMap(flags),
        env: getEnv(flags),
        resolutions: getResolutions(flags)
      });
      console.error(`Extracting ${args.join(', ')}...`);
      const { map } = await generator.extractMap(args);
      await writeMap(map, flags, true);
      break;
    }
    case undefined:
      console.error(`JSPM@${version}`);
      break;
    default:
      throw new Error(`Unknown command ${flags._}.`);
  }
}
catch (e) {
  if (e.jspmError) {
    console.error(`%cERR: %c${e.message}`, 'color: red', 'color: black');
    Deno.exit(1);
  }
  throw e;
}

Deno.exit();
