/*
 *   Copyright 2020 Guy Bedford
 *
 *   Licensed under the Apache License, Version 2.0 (the "License");
 *   you may not use this file except in compliance with the License.
 *   You may obtain a copy of the License at
 *
 *       http://www.apache.org/licenses/LICENSE-2.0
 *
 *   Unless required by applicable law or agreed to in writing, software
 *   distributed under the License is distributed on an "AS IS" BASIS,
 *   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *   See the License for the specific language governing permissions and
 *   limitations under the License.
 */
import { TraceMap, ImportMap } from './tracemap.ts';
import chalk from 'chalk';
import * as fs from 'fs';
import { pathToFileURL, fileURLToPath } from 'url';
import * as rollup from 'rollup';
import jspmRollup from './rollup-plugin.ts';
import ora from './spinner.js';
import { logStream } from './log.ts';
import { clearCache, fetch } from './fetch.ts';
import mkdirp from 'mkdirp';
import rimraf from 'rimraf';
import { readHtmlScripts, isPlain, isURL, jsonParseStyled, getIntegrity, SrcScript, SrcScriptParse, injectInHTML, detectSpace } from './utils.ts';
import * as path from 'path';
import { esmCdnUrl, systemCdnUrl, parseCdnPkg, pkgToStr, parsePackageTarget, getMapMatch, pkgToUrl } from './installtree.ts';
import { Installer } from './installer.ts';
import clipboardy from './clipboardy.js';
import { version } from './version.js';
import process from 'process';

function usage (cmd?: string) {
  switch (cmd) {
  case 'install': return `
  jspm install [-m <importmap>]
  
    Options:
      --import-map/-m          Set the path to the import map file
      --out/-o                 Set the path to the output import map
      --minify/-M              Minify import map output
      --system/-s              Use System modules
      --esm/-e                 Use ES modules
      --log/-l=trace,add   Display debugging logs
  `;
  case 'add': return `
  jspm add [-m <importmap>] <pkg>?+
  
    Options:
      --import-map/-m          Set the path to the import map file
      --out/-o                 Set the path to the output import map
      --minify/-M              Minify import map output
      --system/-s              Use System modules
      --esm/-e                 Use ES modules
      --log/-l=trace,add   Display debugging logs
  `;
  case 'link': return `
  jspm link <entry>+

    Options:
      --import-map/-m          Set the path to the import map file
      --format/-f              module|systemjs|es-module-shims|json
`;
  case 'build': return `
  jspm build [-m <importmap>] <entry>?+ [-d <outdir>]

    Options
      --import-map/-m          Set the path to the import map file
      --dir/-d                 Set the output directory
      --clear-dir/-c           Clear the output directory before optimizing
      --minify/-M              Minify the buildd modules
      --source-map/-S          Output source maps
      --banner/-b              Provide a banner for the buildd files
      --watch/-w               Watch input files for rebuild on change
      --system/-s              Output system module
      --log/-l=build           Enable the given debug log types
  `;
  }
  return `${cmd ? chalk.red(`Unknown command ${chalk.bold(cmd)}\n`) : ``}
  > https://jspm.org/cli#v${version} ▪ ES Module Package Management
  
  Manage and build module and import map workflows:

    jspm add [pkgName]+      add a package into an import map

    jspm install             install and validate all imports

    jspm link [module]+      link a module for serving

    jspm build [module]      build a module graph

  Run "jspm help add" or "jspm help build" for more info.
`;
}

export async function cli (cmd: string | undefined, rawArgs: string[]) {
  // help and version are only commands that support either form in CLI
  if (cmd === '-v' || cmd === '--version')
    cmd = 'version';
  else if (cmd === '-h' || cmd === '--help')
    cmd = 'help';
  switch (cmd) {
    case 'version':
      console.log(`jspm/${version}`);
      break;

    case 'help':
      console.log(usage(rawArgs[0]));
      break;

    case 'cc':
    case 'cache-clean':
      clearCache();
      console.log(`${chalk.bold.green('ok')}   Cache cleared.`);
      break;
    
    case 'trace':
      try {
        const { args, opts } = readFlags(rawArgs, {
          boolFlags: ['log', 'static'],
          strFlags: ['import-map', 'log'],
          aliases: { m: 'import-map', l: 'log' }
        });

        const inMapFile = getInMapFile(opts);
        const inMap = getMapDetectTypeIntoOpts(inMapFile, opts);
        const mapBase = new URL('.', pathToFileURL(inMapFile));
        const traceMap = new TraceMap(mapBase, inMap.map);

        const specifiers = args.length === 0 ? inMap.imports : args;

        if (specifiers.length === 0)
          throw `Nothing to trace.`;

        const { map, trace } = await traceMap.trace(specifiers, { system: <boolean>opts.system, static: opts.static });
        logTrace(map, trace, mapBase);
      }
      catch (e) {
        if (typeof e === 'string')
          throw `${chalk.bold.red('err')}  ${e}`;
        throw e;
      }
      break;

    case 'ls':
    case 'list':
      try {
        const { args, opts } = readFlags(rawArgs, {
          boolFlags: ['log', 'offline'],
          strFlags: ['log', 'format'],
          aliases: { l: 'log', f: 'format', z: 'offline' }
        });
        
        if (!args.length)
          throw 'No module path provided to list';
        if (args.length > 1)
          throw 'Only one module must be passed to list';

        const installer = new Installer(new TraceMap(pathToFileURL(process.cwd())), opts);
        const { target, subpath } = parsePackageTarget(args[0]);
        const resolved = await installer.resolveLatestTarget(target);
        const pcfg = await installer.getPackageConfig(pkgToUrl(resolved, esmCdnUrl));
        const matches: string[] = [];
        for (const key of Object.keys(pcfg.exports || {})) {
          if (key.startsWith(subpath) && !key.endsWith('!cjs'))
            matches.push(key);
        }
        if (!matches.length)
          throw `No exports matching ${subpath} in ${pkgToStr(resolved)}`;
        if (opts.format === 'json') {
          const exports = {};
          for (const key of matches)
            exports[key] = pcfg.exports![key];
          console.log(JSON.stringify({ resolved, exports }, null, 2));
          return;
        }
        if (opts.format && opts.format !== 'string')
          throw `Unknown format ${opts.format}`;
        console.log(pkgToStr(resolved));
        const padding = Math.min(Math.max(<number>matches.map(key => key.length).sort((a, b) => a > b ? 1 : -1).pop() + 2, 20), 80);
        for (const key of matches) {
          const value = pcfg.exports![key];
          if (typeof value === 'string') {
            console.log(key + value.padStart(padding - key.length + value.length, ' '));
          }
          else {
            let depth = 0;
            function logNestedObj (obj): string[] {
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
              return indentGraph(lines, false);
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

    case 'locate':
      try {
        const { args, opts } = readFlags(rawArgs, {
          boolFlags: ['log', 'system', 'copy', 'no-crossorigin', 'no-integrity', 'offline'],
          strFlags: ['log', 'format', 'out'],
          arrFlags: ['conditions'],
          aliases: { l: 'log', f: 'format', c: 'copy', u: 'conditions', o: 'out', z: 'offline' }
        });
        
        if (!args.length)
          throw 'No module path provided to locate';
        if (args.length > 1)
          throw 'Only one module must be passed to locate';

        if (opts.format === 'system')
          opts.system = true;

        let outMapFile: string | null = null;
        if (opts.out) {
          const inMapFile = getInMapFile(opts);
          outMapFile = getOutMapFile(inMapFile, opts);
          if (outMapFile.endsWith('.json') || outMapFile.endsWith('.importmap')) {
            throw `Cannot inject inside a non-html file, requested - ${opts.out}`
          }
        }

        const url = await locate(args[0], opts);

        let statementToImport: string
        const format = opts.format || (opts.system ? 'script' : 'module')
        switch (format) {
          case 'url':
          case 'string':
            statementToImport = url;
            break;
          case 'system':
          case 'script':
            statementToImport = `<script src="${url}"${opts.noIntegrity ? '' : ` integrity="${await getIntegrity(url, opts.offline)}"`}${opts.noCrossorigin ? '' : ' crossorigin="anonymous"'}></script>`;
            break;
          case '@import':
            statementToImport = `@import url('${url}')`
            break;
          case 'style':
            statementToImport = `<link rel="stylesheet" href="${url}"${opts.noIntegrity ? '' : ` integrity="${await getIntegrity(url, opts.offline)}"`}${opts.noCrossorigin ? '' : ' crossorigin="anonymous"'}/>`
            break;
          case 'module':
            statementToImport = `<script type="module" src="${url}"${opts.noIntegrity ? '' : ` integrity="${await getIntegrity(url, opts.offline)}"`}${opts.noCrossorigin ? '': ' crossorigin="anonymous"'}></script>`  
            break;
          default:
            throw `Unknown format ${opts.format}`;
        }

        output(statementToImport, opts);
        if (opts.out && ['script', 'system', 'module', 'style'].includes(format)) {

          if (!fs.existsSync(outMapFile)) {
            throw `\n Requested file to link is missing - ${outMapFile}`
          }
        
          let outSource = fs.readFileSync(outMapFile).toString();
          const injectedHTML = injectInHTML(outSource,outMapFile, statementToImport);
          
          fs.writeFileSync(outMapFile, injectedHTML);
        }
        return

      }
      catch (e) {
        if (typeof e === 'string')
          throw `${chalk.bold.red('err')}  ${e}`;
        throw e;
      }
      break;

    case 'init':
      throw new Error('TODO: jspm init');

    case 'checkout':
    case 'co':
      const { args, opts } = readFlags(rawArgs, {
        boolFlags: ['beautify', 'minify', 'out', 'flatten', 'system', 'esm', 'copy', 'offline'],
        strFlags: ['import-map', 'log', 'dir', 'out', 'relative'],
        aliases: { m: 'import-map', l: 'log', d: 'dir', b: 'beautify', o: 'out', M: 'minify', F: 'flatten', p: 'production', s: 'system', e: 'esm', c: 'copy', r: 'reset', z: 'offline' }
      });

      const inMapFile = getInMapFile(opts);
      const inMap = getMapDetectTypeIntoOpts(inMapFile, Object.assign({}, opts));
      const mapBase = new URL('.', pathToFileURL(inMapFile));
      const traceMap = new TraceMap(mapBase, inMap.map);

      const outMapFile = getOutMapFile(inMapFile, opts);
      // const outBase = outMapFile ? new URL('.', pathToFileURL(outMapFile)) : mapBase;

      let pkgs;

      if (!args.length)
        throw `${chalk.bold.red('err')} A package name is needed to checkout.`;

      class Pool {
        POOL_SIZE = 10;
        opCnt = 0;
        cbs: (() => void)[] = [];
        constructor (POOL_SIZE) {
          this.POOL_SIZE = POOL_SIZE;
        }
        async queue () {
          if (++this.opCnt > this.POOL_SIZE)
            await new Promise(resolve => this.cbs.push(resolve));
        }
        pop () {
          this.opCnt--;
          const cb = this.cbs.pop();
          if (cb) cb();
        }
      }
      const dlPool = new Pool(20);

      const spinner = startSpinnerLog(opts.log);
      if (spinner) spinner.text = `Checking out ${args.join(', ').slice(0, process.stdout.columns - 21)}...`;
      try {
        pkgs = await traceMap.pkgSelect(args);
        const pkgFiles: Record<string, string | ArrayBuffer>[] = await Promise.all(pkgs.map(async ({ pkgUrl, pkgCfg }) => {
          const pkgContents: Record<string, string | ArrayBuffer> = Object.create(null);
          await Promise.all((pkgCfg.files || []).map(async file => {
            const url = pkgUrl + file;
            await dlPool.queue();
            try {
              const res = await fetch(url, opts.offline ? { cache: 'only-if-cached' } : {});
              switch (res.status) {
                case 304:
                case 200:
                  const contentType = res.headers && res.headers.get('content-type');
                  let contents: string | ArrayBuffer = await res.arrayBuffer();
                  if (opts.beautify) {
                    if (contentType === 'application/javascript') {
                      // contents = jsBeautify(contents);
                    }
                    else if (contentType === 'application/json') {
                      contents = JSON.stringify(JSON.parse(contents.toString()), null, 2);
                    }
                  }
                  return pkgContents[file] = contents;
                default: throw `${chalk.bold.red('err')}  Invalid status code ${res.status} looking up ${url} - ${res.statusText}`;
              }
            }
            finally {
              dlPool.pop();
            }
          }));
          return pkgContents;
        }));

        const dir = opts.dir || 'checkouts';
        for (let i = 0; i < pkgFiles.length; i++) {
          const files = pkgFiles[i];
          const { pkgUrl, pkgCfg } = pkgs[i];
          const name = pkgCfg.name;

          if (fs.existsSync(dir + '/' + name))
            throw `${chalk.bold.red('err')}  Checkout directory ${chalk.bold(dir + '/' + name)} already exists.`;

          for (const file of Object.keys(files)) {
            const filePath = dir + '/' + name + '/' + file;
            mkdirp.sync(path.dirname(filePath));
            fs.writeFileSync(filePath, Buffer.from(files[file]));
          }

          traceMap.replace(pkgUrl, pathToFileURL(dir + '/' + name + '/'));
        }

        const mapStr = traceMap.toString(<boolean>opts.minify);
        if (opts.copy) {
          console.log(chalk.bold('(Import map copied to clipboard)'));
          clipboardy.writeSync(mapStr);
        }
        if (outMapFile) {
          await writeMap(outMapFile, mapStr, <boolean>opts.system);
        }
        else {
          process.stdout.write(mapStr);
        }
      }
      finally {
        if (spinner) spinner.stop();
      }

      console.log(`${chalk.bold.green('ok')}   Checked out ${chalk.bold(pkgs.map(({pkgCfg}) => pkgCfg.name + '@' + pkgCfg.version))}`)
      break;

    case 'link':
      try {
        const { args, opts } = readFlags(rawArgs, {
          boolFlags: ['log', 'copy', 'integrity', 'crossorigin', 'depcache', 'minify', 'out', 'clear', 'flatten', 'production', 'dynamic', 'system', 'preload', 'esm', 'static'],
          strFlags: ['import-map', 'log', 'relative', 'out'],
          aliases: { m: 'import-map', l: 'log', c: 'copy', o: 'out', M: 'minify', d: 'depcache', F: 'flatten', p: 'production', s: 'system', e: 'esm' }
        });

        if (!opts.system && !opts.esm && (opts.production || args.some(arg => !isPlain(arg) && arg.endsWith('.ts'))))
          opts.system = true;

        const inMapFile = getInMapFile(opts);
        const outMapFile = getOutMapFile(inMapFile, opts);
        const inMap = getMapDetectTypeIntoOpts(inMapFile, Object.assign({}, opts));
        const mapBase = new URL('.', pathToFileURL(inMapFile));
        const traceMap = new TraceMap(mapBase, inMap.map);
        const outBase = outMapFile ? new URL('.', pathToFileURL(outMapFile)) : mapBase;

        if (opts.production) {
          opts.integrity = true;
          if (opts.system) {
            opts.dynamic = true;
            opts.depcache = true;
          }
          opts.preload = true;
          opts.crossorigin = true;
        }

        if (opts.clear) {
          if (args.length !== 0)
            throw `Unexpected module arguments. Use eg ${chalk.bold(`jspm cast ${rawArgs.filter(arg => !args.includes(arg)).join(' ')}`)} without any module arguments to remove existing casts.`;
        }

        let staticSize = 0;
        let dynamicSize = 0;
        let sortedStatic: any[] = [];
        traceMap.clearIntegrity();
        traceMap.clearDepcache();
        if (!opts.clear) {
          const spinner = startSpinnerLog(opts.log);
          if (spinner) spinner.text = `Linking${args.length ? ' ' + args.join(', ').slice(0, process.stdout.columns - 16) : ''}...`;

          try {
            if (await traceMap.traceInstall(args, { clean: false, system: <boolean>opts.system, static: <boolean>opts.static, offline: <boolean>opts.offline })) {
              const mapStr = traceMap.toString();
              await writeMap(inMapFile, mapStr, false);
            }
            await traceMap.traceInstall(args, { clean: true, system: <boolean>opts.system, static: <boolean>opts.static, offline: <boolean>opts.offline });
            var { trace } = await traceMap.trace(args, { system: <boolean>opts.system, depcache: <boolean>opts.depcache && <boolean>opts.dynamic, static: <boolean>opts.static });
            var allSystem = true;
            for (const url of Object.keys(trace)) {
              if (!trace[url].system) {
                allSystem = false;
                if (!opts.production)
                  break;
                if (opts.system)
                  console.log(`\n${chalk.yellow('WARN')} Not a System production module ${chalk.cyan(url)}`);
              }
            }
          }
          finally {
            if (spinner) spinner.stop();
          }

          sortedStatic = Object.keys(trace).filter(t => !trace[t].dynamicOnly).sort((a, b) => trace[a].order > trace[b].order ? 1 : -1).map(dep => {
            staticSize += trace[dep].size;
            if (!dep.startsWith('file:'))
              return dep;
            const rel = relModule(new URL(dep), outBase, false);
            return rel.startsWith('./') ? rel.slice(2) : rel;
          });

          // iterate the dynamic to compute dynamic size and populate their integrity
          for (const m of Object.keys(trace)) {
            const entry = trace[m];
            if (!entry.dynamicOnly)
              continue;
            dynamicSize += trace[m].size;
            if (opts.integrity && opts.dynamic) {
              const resolved = m.startsWith('https:') || m.startsWith('file:') ? new URL(m) : pathToFileURL(path.resolve(<string>opts.relative || process.cwd(), m));
              traceMap.setIntegrity(relModule(resolved, outBase, false), await getIntegrity(resolved.href));
            }
          }
          if (opts.integrity && opts.dynamic)
            traceMap.sortIntegrity();
        }

        if (!opts.preload) {
          sortedStatic = args.map(specifier => {
            const resolved = traceMap.resolve(specifier, traceMap.baseUrl);
            if (!resolved)
              throw new Error(`No resolution for ${specifier}.`);
            const rel = relModule(resolved, outBase, false);
            return rel.startsWith('./') ? rel.slice(2) : rel;
          });
        }

        const outputPreloads: SrcScript[] = await Promise.all(sortedStatic.map(async dep => ({
          type: opts.system ? (dep.endsWith('.ts') || dep.endsWith('.json') || dep.endsWith('.css') || dep.endsWith('.wasm') ? 'systemjs-module' : '') : 'module',
          src: dep,
          integrity: !opts.integrity ? undefined : await getIntegrity(dep.startsWith('https://') ? dep : new URL(dep, outBase)),
          crossorigin: opts.crossorigin ? dep.startsWith(systemCdnUrl) || dep.startsWith(esmCdnUrl) : false,
          jspmCast: !dep.startsWith(systemCdnUrl) && !dep.startsWith(esmCdnUrl)
        })));

        traceMap.flatten();
        const mapStr = opts.clear ? '{}\n' : traceMap.toString(<boolean>opts.minify);
        const preloads = outputPreloads.map(({ type, src, integrity, crossorigin, jspmCast }) =>
          `<script ${type ? `type="${type}" ` : ''}src="${src}"${integrity ? ` integrity="${integrity}"` : ''}${crossorigin ? ' crossorigin="anonymous"' : ''}${jspmCast ? ' jspm-link' : ''}></script>`
        ).join('\n');
        if (outMapFile) {
          if (outMapFile.endsWith('.importmap')) {
            fs.writeFileSync(outMapFile, mapStr);
          }
          else if (outMapFile.endsWith('.json')) {
            if (opts.clear)
              throw `Can only clear casts in XML files.`;
            const outObj = {
              importMap: JSON.parse(mapStr),
              preloads
            };
            fs.writeFileSync(outMapFile, opts.minify ? JSON.stringify(outObj) : JSON.stringify(outObj, null, 2));
          }
          else {
            await writeMap(outMapFile, mapStr, <boolean>opts.system, opts.system && !allSystem, <boolean>opts.integrity, <boolean>opts.crossorigin);
            writePreloads(outMapFile, outputPreloads, opts.minify ? true : false);
          }
          if (opts.clear)
            console.log(`${chalk.bold.green('ok')}   Links cleared.`);
          else
            console.log(`${chalk.bold.green('ok')}   Linked${args.length ? ' ' + args.map(name => chalk.bold(name)).join(', ') : ''}${outMapFile !== inMapFile ? ` into ${outMapFile}` : ''} ${(staticSize || dynamicSize) ? `(${chalk.cyan.bold(`${Math.round(staticSize / 1024 * 10) / 10}KiB`)}${dynamicSize ? ' static, ' + chalk.cyan(`${Math.round(dynamicSize / 1024 * 10) / 10}KiB`) + ' dynamic' : ''}).` : ''}`);
        }
        else if (opts.out) {
          output((mapStr === '{}' ? '' : `<script type="${opts.system ? 'systemjs-importmap' : 'importmap'}">\n` + mapStr + '</script>\n') + preloads + '\n', opts);
        }
      }
      catch (e) {
        if (typeof e === 'string')
          throw `${chalk.bold.red('err')}  ${e}`;
        throw e;
      }
      break;

    case 'resolve':
      try {
        const { args, opts } = readFlags(rawArgs, {
          boolFlags: ['relative', 'log', 'copy'],
          strFlags: ['relative', 'import-map', 'log'],
          aliases: { m: 'import-map', l: 'log', r: 'relative', c: 'copy' }
        });

        if (args.length > 2)
          throw `Resolve only takes two arguments.`;
        if (args.length === 0)
          throw `Resolve must take a specifier to resolve.`;
        const inMapFile = getInMapFile(opts);
        const inMap = getMapDetectTypeIntoOpts(inMapFile, opts);
        const traceMap = new TraceMap(new URL('.', pathToFileURL(inMapFile)).href, inMap.map);

        const baseUrl = new URL('.', pathToFileURL(inMapFile));
        const parentUrl = args[1] && await traceMap.resolve(args[1], baseUrl) || baseUrl;

        const resolved = await traceMap.resolve(args[0], parentUrl);
        if (resolved === null) {
          output('@empty', opts);
        }
        else if (opts.relative && resolved.protocol === 'file:') {
          output(relModule(resolved, pathToFileURL(opts.relative === true ? process.cwd() : path.resolve(opts.relative))), opts);
        }
        else {
          output(resolved.href, opts);
        }
      }
      catch (e) {
        if (typeof e === 'string')
          throw `${chalk.bold.red('err')}  ${e}`;
        throw e;
      }
      break;

    case 'up':
    case 'update':
      throw `${chalk.bold.red('err')}  TODO: jspm update`;

    case 'upgrade':
      throw `${chalk.bold.red('err')}  TODO: jspm upgrade`;

    case 'rem':
    case 'uninstall':
    case 'remove': {
      const { args, opts } = readFlags(rawArgs, {
        boolFlags: ['log', 'copy', 'minify'],
        strFlags: ['out', 'log', 'import-map'],
        aliases: { m: 'import-map', o: 'out', l: 'log', c: 'copy', 'M': 'minify' }
      });

      opts.clean = true;

      const inMapFile = getInMapFile(opts);
      const outMapFile = getOutMapFile(inMapFile, opts);
      const inMap = getMapDetectTypeIntoOpts(inMapFile, opts);

      const traceMap = new TraceMap(new URL('.', pathToFileURL(inMapFile)).href, inMap.map);

      for (const arg of args) {
        if (!traceMap.remove(arg))
          throw `${chalk.bold.red('err')}  Cannot remove ${chalk.bold(arg)} as it doesn't exist in "imports".`;
      }

      await traceMap.traceInstall(opts);

      const imports = traceMap.map.imports;
      for (const arg of args) {
        if (imports[arg])
          throw `${chalk.bold.red('err')}  Cannot remove ${chalk.bold(arg)} as it is in use by an existing package.`;
      }

      const mapStr = traceMap.toString(<boolean>opts.minify);
      if (opts.copy) {
        console.log(chalk.bold('(Import map copied to clipboard)'));
        clipboardy.writeSync(mapStr);
      }

      await writeMap(outMapFile, mapStr, <boolean>opts.system);
      console.log(`${chalk.bold.green('ok')}   Removed ${args.map(arg => chalk.bold(arg)).join(', ')}.`);
      break;
    }
  
    case undefined:
    case 'install':
    case 'add':
      try {
        // TODO: Flags
        // lock | latest | clean | force | installExports
        // flatten / clean only ones needing dev work?
        // clean works based on tracking which paths were used, removing unused
        // only applies to arguments install (jspm install --clean) and not any other
        const { args, opts } = readFlags(rawArgs, {
          boolFlags: ['flatten', 'system', 'esm', 'minify', 'log', 'copy', 'deno', 'dev', 'production', 'node', 'static', 'out', 'offline', 'save', 'save-dev', 'save-peer', 'save-optional'],
          strFlags: ['import-map', 'out', 'log', 'conditions', 'stdlib'],
          arrFlags: ['reset'],
          aliases: { m: 'import-map', o: 'out', l: 'log', f: 'flatten', M: 'minify', s: 'system', e: 'esm', c: 'copy', r: 'reset', z: 'offline' }
        });

        const conditions = [];
        if (opts.dev && opts.production)
          throw `Must install for dev or production not both.`;
        if (opts.production)
          conditions.push('production');
        else
          conditions.push('development');
        if (opts.deno) {
          // This is "Deno Node.js emulation"
          conditions.push('deno');
          conditions.push('node');
        }
        else if (opts.node)
          conditions.push('node');
        else
          conditions.push('browser');

        const inMapFile = getInMapFile(opts);
        const outMapFile = getOutMapFile(inMapFile, opts);
        const inMap = getMapDetectTypeIntoOpts(inMapFile, opts);
        const traceMap = new TraceMap(new URL('.', pathToFileURL(inMapFile)).href, inMap.map, conditions);

        const spinner = startSpinnerLog(opts.log);
        

        let changed = false;
        try {
          if (opts.reset) {
            opts.clean = true;
            const pkgs = await traceMap.pkgSelect(opts.reset);
            if (spinner) spinner.text = `Resetting ${opts.reset.join(', ').slice(0, process.stdout.columns - 19)}...`;
            for (const { pkgUrl, pkgCfg } of pkgs)
              traceMap.pkgReset(pkgUrl, pkgCfg);
          }
          if (spinner) spinner.text = `Installing${args.length ? ' ' + args.join(', ').slice(0, process.stdout.columns - 19) : ''}...`;
          if (args.length === 0) {
            if (opts.save || opts.saveDev || opts.savePeer || opts.saveOptional)
              throw `--save flags only supported for explicit package installs.`;
            opts.clean = args.length === 0;
            changed = await traceMap.traceInstall(args.length ? args : inMap.imports, opts) || opts.clean;
          }
          else {
            changed = await traceMap.add(args.map(arg => {
              const eqIndex = arg.indexOf('=');
              const target = eqIndex === -1 ? arg : arg.slice(eqIndex + 1);
              const fullTarget = target.match(/^\.$|^\.?\.?\//) ? new URL(target, pathToFileURL(process.cwd()) + '/').href : target;
              if (eqIndex === -1)
                return fullTarget;
              return {
                name: arg.slice(0, eqIndex),
                target: fullTarget
              };
            }), opts);
          }
        }
        finally {
          if (spinner) spinner.stop();
        }
        if (changed) {
          // TODO: Styled JSON read / write
          // TODO: rebase to output map path
          const mapStr = traceMap.toString(<boolean>opts.minify);
          if (opts.copy) {
            console.log(chalk.bold('(Import map copied to clipboard)'));
            clipboardy.writeSync(mapStr);
          }
          if (outMapFile) {
            await writeMap(outMapFile, mapStr, <boolean>opts.system);
            console.log(`${chalk.bold.green('ok')}   Successfully installed.`);
          }
          else {
            process.stdout.write(mapStr);
          }
        }
        else {
          console.log(`${chalk.bold.green('ok')}   Already installed.`);
        }
      }
      catch (e) {
        if (typeof e === 'string')
          throw `${chalk.bold.red('err')}  ${e}`;
        throw e;
      }
      break;
  
    case 'build':
      try {
        const { args, opts } = readFlags(rawArgs, {
          boolFlags: ['clear-dir', 'source-map', 'watch', 'minify', 'out', 'log', 'flatten', 'depcache', 'inline-maps', 'package', 'entry-hash', 'inline', 'production', 'system', 'esm', 'inline-dynamic-imports', 'static', 'offline'],
          strFlags: ['import-map', 'dir', 'out', 'banner', 'log'],
          aliases: { m: 'import-map', c: 'clear-dir', S: 'source-map', w: 'watch', M: 'minify', o: 'out', l: 'log', d: 'dir', b: 'banner', i: 'inline', p: 'production', s: 'system', e: 'system', z: 'offline' }
        });

        if (opts.production && !opts.system && !opts.esm)
          opts.system = true;

        if (opts.production)
          opts.minify = true;

        if (opts.out)
          opts.entryHash = true;

        const dir = opts.dir ? ((<string>opts.dir).endsWith('/') ? (<string>opts.dir).slice(0, -1) : <string>opts.dir) : 'dist';

        const inMapFile = getInMapFile(opts);
        const outMapFile = getOutMapFile(inMapFile, opts);
        const map = getMapDetectTypeIntoOpts(inMapFile, Object.assign({}, opts));
        const baseUrl = new URL('.', pathToFileURL(inMapFile));

        let distMapRelative = path.relative(process.cwd(), dir).replace(/\//g, '/');
        if (!distMapRelative.startsWith('../'))
          distMapRelative = './' + distMapRelative;

        const inputObj: Record<string, string> = {};
        const modules = args.length ? args : Object.keys(map.imports);
        for (const module of modules) {
          let basename = path.basename(module);
          if (basename.indexOf('.') !== -1)
            basename = basename.substr(0, basename.lastIndexOf('.'));
          let inputName = basename;
          let i = 0;
          while (inputName in inputObj)
            inputName = basename + i++;
          inputObj[inputName] = module;
        }
        
        const externals = !opts.inline;

        const rollupOptions: any = {
          input: inputObj,
          onwarn: () => {},
          preserveEntrySignatures: 'allow-extension',
          plugins: [jspmRollup({ map: JSON.parse(map.map), baseUrl, externals, format: <string>opts.format, inlineMaps: <boolean>opts.inlineMaps, sourceMap: opts.sourceMap, minify: <boolean>opts.minify, offline: <boolean>opts.offline })]
        };

        const outputOptions = {
          entryFileNames: opts.entryHash ? '[name]-[hash].js' : '[name].js',
          chunkFileNames: 'chunk-[hash].js',
          dir,
          compact: opts.minify,
          format: opts.system ? 'system' : 'esm',
          inlineDynamicImports: opts.inlineDynamicImports,
          sourcemap: opts.sourceMap,
          indent: true,
          interop: false,
          banner: opts.banner,
          systemNullSetters: true,
          namespaceToStringTag: true
        };

        const { json: outMap, style: outMapStyle } = jsonParseStyled(map.map);
        if (opts.minify)
          outMapStyle.indent = outMapStyle.tab = outMapStyle.newline = '';

        if (opts.watch) {
          const spinner = startSpinnerLog(opts.log);
          if (spinner) spinner.text = `Building${args.length ? ' ' + args.join(', ').slice(0, process.stdout.columns - 17) : ''}...`;

          rollupOptions.watch = { skipWrite: true };
          const watcher = await rollup.watch(rollupOptions);
          let firstRun = true;
          (<any>watcher).on('event', async ({ code, result, error }) => {
            if (code === 'errOR') {
              firstRun = false;
              spinner.stop();
              if (error.frame) {
                console.error(error.id);
                console.error(error.frame);
              }
              delete error.frame;
              delete error.loc;
              delete error.pos;
              delete error.raisedAt;
              delete error.code;
              delete error.pluginCode;
              delete error.plugin;
              delete error.hook;
              delete error.id;
              delete error.watchFiles;
              console.error(error);
              process.exit(1);
            }
            else if (firstRun) {
              firstRun = false;
            }
            else if (code === 'BUNDLE_START') {
              if (spinner) {
                spinner.start();
                spinner.text = `Building${args.length ? ' ' + args.join(', ').slice(0, process.stdout.columns - 17) : ''}...`;
              }
            }
            else if (code === 'BUNDLE_END') {
              const { output } = await result.write(outputOptions);
              spinner.stop();
              console.log(`${chalk.bold.green('ok')}   Built into ${chalk.bold(dir + '/')}`);

              if (opts.out) {
                const outArgs = Object.keys(inputObj).map(input => `${distMapRelative}/${output.find(chunk => chunk.name === input).fileName}`);
                await cli('link', [
                  ...outArgs,
                  ...opts.importMap ? ['-m', <string>opts.importMap] : [],
                  ...opts.production ? ['--production'] : [],
                  ...opts.out === true ? ['-o'] : opts.out ? ['-o', <string>opts.out] : [],
                  ...opts.system ? ['--system'] : [],
                  ...opts.esm ? ['--esm'] : [],
                  ...opts.static ? ['--static'] : []
                ]);
              }

              console.log(`     Watching for changes...`);
            }
          });
          // keep alive
          setInterval(() => {}, 5000);
          return;
        }

        const spinner = startSpinnerLog(opts.log);
        if (spinner) spinner.text = `Building${args.length ? ' ' + args.join(', ').slice(0, process.stdout.columns - 17) : ''}...`;

        try {
          const build = await rollup.rollup(rollupOptions);

          if (opts.clearDir) {
            rimraf.sync(dir);
            mkdirp.sync(dir);
          }

          const { output } = await build.write(outputOptions);

          spinner.stop();
          console.log(`${chalk.bold.green('ok')}   Built into ${chalk.bold(dir + '/')}`);

          if (opts.out) {
            const outArgs = Object.keys(inputObj).map(input => `${distMapRelative}/${output.find(chunk => chunk.name === input).fileName}`);
            await cli('link', [
              ...outArgs,
              ...opts.importMap ? ['-m', <string>opts.importMap] : [],
              ...opts.production ? ['--production'] : [],
              ...opts.out === true ? ['-o'] : opts.out ? ['-o', <string>opts.out] : [],
              ...opts.system ? ['--system'] : [],
              ...opts.esm ? ['--esm'] : []
            ]);
          }
        }
        catch (e) {
          if (spinner) spinner.stop();
          throw e;
        }
      }
      catch (e) {
        if (typeof e === 'string')
          throw `${chalk.bold.red('err')}  ${e}`;
        throw e;
      }
      break;

    default:
      throw usage(cmd);
  }
}

const nodes = {
  end: chalk.bold('└'),
  middle: chalk.bold('├'),
  skip: chalk.bold('│'),
  item: chalk.bold('╴')
};

function isItemLine (line: string) {
  return  !line.startsWith(nodes.end) && !line.startsWith(nodes.middle) && !line.startsWith(nodes.skip) && line[0] !== ' ';
}
function indentGraph (lines: string[]) {
  let lastItemLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (isItemLine(lines[i])) {
      lastItemLine = i;
    }
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isItemLine(line))
      lines[i] = (i >= lastItemLine ? nodes.end : nodes.middle) + nodes.item + line;
    else
      lines[i] = (i >= lastItemLine ? ' ' : nodes.skip) + ' ' + line;
  }
  return lines;
}
function logTrace (map, trace, mapBase: URL) {

  const seen = new Map();
  let idx = 0;
  console.log('');
  for (const specifier of Object.keys(map)) {
    for (const line of logVisit(specifier, map, null, false)) {
      console.log(line);
    }
  }

  function logVisit (specifier, curMap, parentURL, dynamic): string[] {
    const resolved = curMap[specifier];
    const resolvedTrace = trace[resolved.href];
    const keys = Object.keys(resolvedTrace.deps);
    const dynamicKeys = Object.keys(resolvedTrace.dynamicDeps);

    if (seen.has(resolved.href)) {
      if (isPlain(specifier))
        return [`${specifier} ${(`@${seen.get(resolved.href)}`)}`];
      return [];
    }

    const curIdx = ++idx;
    seen.set(resolved.href, curIdx);

    let depGraphLines: string[] = [];
    for (let i = 0; i < keys.length; i++) {
      depGraphLines = depGraphLines.concat(logVisit(keys[i], resolvedTrace.deps, resolved, false));
    }
    for (let i = 0; i < dynamicKeys.length; i++) {
      if (keys.includes(dynamicKeys[i]))
        continue;
      depGraphLines = depGraphLines.concat(logVisit(dynamicKeys[i], resolvedTrace.dynamicDeps, resolved, true));
    }
    const logSpecifier = isPlain(specifier) ? specifier : isURL(specifier) ? relModule(resolved, parentURL) : specifier;
    return [
      `${dynamic ? chalk.bold.black(logSpecifier) : logSpecifier} ${isPlain(specifier) ? `(${relModule(resolved, mapBase)}) ` : ''}${chalk.cyan(`${Math.round(resolvedTrace.size / 1024 * 10) / 10}KiB`)} ${chalk.black.bold(`[${curIdx}]`)}`,
      ...indentGraph(depGraphLines)
    ];
  }
}

function relModule (url: URL, relBase: URL, parse = true) {
  if (url.protocol === 'file:' && relBase.protocol === 'file:') {
    const relBasePath = fileURLToPath(relBase);
    let relPath = path.relative(relBasePath, fileURLToPath(url)).replace(/\\/g, '/');
    if (!relPath.startsWith('../'))
      relPath = './' + relPath;
    return relPath;
  }
  else if (url.protocol === relBase.protocol && url.origin === relBase.origin && url.pathname.slice(1, url.pathname.indexOf('/')) !== relBase.pathname.slice(1, relBase.pathname.indexOf('/'))) {
    let relPath = path.relative(path.dirname(relBase.pathname), url.pathname).replace(/\\/g, '/');
    if (!relPath.startsWith('../'))
      relPath = './' + relPath;
    return relPath;
  }
  else {
    const parsed = parse && parseCdnPkg(url.href);
    if (parsed)
      return pkgToStr(parsed) + parsed.path;
    else
      return url.href;
  }
}

function getInMapFile (opts: Record<string, string | boolean>): string {
  let inMapFile = <string>opts.importMap || 'jspm.importmap';
  if (inMapFile.endsWith('/') || inMapFile.endsWith('\\'))
    inMapFile += 'jspm.importmap';
  return inMapFile;
}

function getOutMapFile (inMapFile: string, opts: Record<string, string | boolean>): string | undefined {
  if (opts.out === true)
    return;
  let outMapFile = opts.out || inMapFile;
  if (outMapFile.endsWith('/') || outMapFile.endsWith('\\'))
    outMapFile += 'jspm.importmap';
  return outMapFile;
}

function writePreloads (outMapFile: string, preloads: SrcScript[], minify: boolean) {
  let outSource = fs.existsSync(outMapFile) ? fs.readFileSync(outMapFile).toString() : '';
  let { map: [,,,mapOuterEnd], srcScripts } = readHtmlScripts(outSource, outMapFile);
  const space = minify ? '' : detectSpace(outSource, mapOuterEnd - 1);

  let diff = 0;
  // first remove existing preloads
  for (const script of srcScripts) {
    if (script.start < mapOuterEnd)
      continue;
    const isPreload = script.src && (script.src.startsWith(systemCdnUrl) || script.src.startsWith(esmCdnUrl)) || script.jspmCast;
    if (isPreload)
      ({ outSource, diff } = removeScript(outSource, diff, script, mapOuterEnd));
  }

  const outPreloadSource = (mapOuterEnd !== -1 && preloads.length ? (space || '\n') : '') + preloads.map(({ type, src, integrity, crossorigin, jspmCast }) =>
    `<script ${type ? `type="${type}" ` : ''}src="${src}"${integrity ? ` integrity="${integrity}"` : ''}${crossorigin ? ' crossorigin="anonymous"' : ''}${jspmCast ? ' jspm-link' : ''}></script>`
  ).join(space) + (outSource === '' ? '\n' : '');
  outSource = outSource.slice(0, mapOuterEnd) + outPreloadSource + outSource.slice(mapOuterEnd);
  fs.writeFileSync(outMapFile, outSource);
}

function removeScript (outSource: string, diff: number, script: SrcScriptParse, mapOuterEnd: number): { outSource: string, diff: number } {
  let spaceLen = 0;
  const nl = outSource.lastIndexOf('\n', script.start + diff);
  if (nl !== -1) {
    const detectedSpace = outSource.slice(nl, script.start + diff);
    if (detectedSpace.match(/\s*/))
      spaceLen = detectedSpace.length;
  }
  // never overshoot ws removal into the map itself
  while (script.start - spaceLen + diff < mapOuterEnd)
    spaceLen--;
  outSource = outSource.slice(0, script.start - spaceLen + diff) + outSource.slice(script.end + diff);
  diff -= script.end - script.start + spaceLen;
  return { outSource, diff };
}

async function writeMap (outMapFile: string, mapString: string, system: boolean, systemBabel = false, integrity = false, crossorigin = false) {
  if (outMapFile.endsWith('.importmap') || outMapFile.endsWith('.json')) {
    fs.writeFileSync(outMapFile, mapString);
  }
  else {
    let outSource = fs.existsSync(outMapFile) ? fs.readFileSync(outMapFile).toString() : `<script type="${system ? 'systemjs-importmap' : 'importmap'}"></script>\n`;
    let { type: [typeStart, typeEnd], map: [mapStart, mapEnd, mapOuterStart, mapOuterEnd], srcScripts } = readHtmlScripts(outSource, outMapFile);
    if (mapStart === -1)
      throw `No <script type="${system ? 'systemjs-importmap' : 'importmap'}"> found in ${outMapFile}`;
    let diff = 0;
    // remove top casts only above the map
    const space = detectSpace(outSource, mapOuterStart) || '\n';
    for (const script of srcScripts) {
      if (script.start > mapOuterEnd)
        continue;
      if (script.jspmCast)
        ({ outSource, diff } = removeScript(outSource, diff, script, 0));
    }
    if (system && !srcScripts.some(({ src, jspmCast }) => src && !jspmCast && (src.match(/(^|\/)(system|s)(\.min)?\.js$/)))) {
      const url = await locate('systemjs/s.js', system);
      const script = `<script src="${url}"${integrity ? ` integrity="${await getIntegrity(url)}"` : ''}${crossorigin ? ' crossorigin="anonymous"' : ''} jspm-link></script>`;
      outSource = outSource.slice(0, mapOuterStart + diff) + script + space + outSource.slice(mapOuterStart + diff);
      diff += script.length + space.length;
    }
    if (systemBabel && !srcScripts.some(({ src, jspmCast }) => src && !jspmCast && src.endsWith('systemjs-babel.js'))) {
      const url = await locate('systemjs-babel', system);
      const script = `<script src="${url}"${integrity ? ` integrity="${await getIntegrity(url)}"` : ''}${crossorigin ? ' crossorigin="anonymous"' : ''} jspm-link></script>`;
      outSource = outSource.slice(0, mapOuterStart + diff) + script + space + outSource.slice(mapOuterStart + diff);
      diff += script.length + space.length;
    }
    if (system && outSource.slice(typeStart, typeEnd) !== 'systemjs-importmap') {
      outSource = outSource.slice(0, typeStart + diff) + 'systemjs-importmap' + outSource.slice(typeEnd + diff);
      diff += 18 - (typeEnd - typeStart);
    }
    if (!system && outSource.slice(typeStart, typeEnd) !== 'importmap' && outSource.slice(typeStart, typeEnd) !== 'importmap-shim') {
      // Esm switch
      outSource = outSource.slice(0, typeStart + diff) + 'importmap' + outSource.slice(typeEnd + diff);
      diff += 9 - (typeEnd - typeStart);
    }
    outSource = outSource.slice(0, mapStart + diff) + '\n' + mapString + outSource.slice(mapEnd + diff);
    diff += mapString.length + 1 - (mapEnd - mapStart);
    fs.writeFileSync(outMapFile, outSource);
  }
}

// TODO: refactor this stuff more sensibly
function getMapDetectTypeIntoOpts (inMapFile: string, opts: Record<string, string | boolean>): { map: string, imports: string[] } {
  let inMap: ImportMap = { imports: {}, scopes: {}, depcache: {} };
  const returnVal: {
    map: string,
    imports: string[]
  } = {
    map: '{}\n',
    imports: []
  };
  if (fs.existsSync(inMapFile)) {
    const source = fs.readFileSync(inMapFile).toString();    
    // support HTML parsing
    if (!inMapFile.endsWith('.importmap') && !inMapFile.endsWith('.json')) {
      const { type, map, srcScripts } = readHtmlScripts(source, inMapFile);
      if (map[0] === -1)
        throw `${inMapFile} must be a ".importmap" or ".json" file, or an XML file containing a <script type="importmap"> section.`;
      const mapStr = source.slice(map[0], map[1]);
      if (mapStr.trim().length !== 0) {
        const firstNewline = mapStr.match(/\n|[^\s]/)?.index;
        returnVal.map = Number(firstNewline) > -1 ? mapStr.slice(<number>firstNewline + 1) : mapStr;
      }
      inMap = JSON.parse(source.slice(...map).trim() || '{}');
      if (!opts.system && !opts.esm) {
        if (source.slice(...type) === 'systemjs-importmap')
          opts.system = true;
        else
          opts.esm = true;
      }
      returnVal.imports = [
        ...Object.keys(inMap.imports || {}),
        ...opts.system ? [] : srcScripts.filter(script => !script.src).map(script => `data:application/javascript,${encodeURIComponent(source.slice(script.srcStart, script.srcEnd))}`)
      ];
    }
    else {
      returnVal.map = fs.readFileSync(inMapFile).toString();
      if (returnVal.map.trim().length === 0)
        returnVal.map = '{}\n';
      inMap = JSON.parse(returnVal.map);
      returnVal.imports = Object.keys(inMap.imports || {});
    }
  }

  // esm / system detection
  if (!opts.esm && !opts.system) {
    if (inMap.imports) {
      for (const val of Object.values(inMap.imports)) {
        if (val?.startsWith(esmCdnUrl)) {
          opts.esm = true;
          return returnVal;
        }
        if (val?.startsWith(systemCdnUrl)) {
          opts.system = true;
          return returnVal;
        }
      }
    }
    if (inMap.scopes) {
      for (const scope of Object.keys(inMap.scopes)) {
        if (scope.startsWith(esmCdnUrl)) {
          opts.esm = true;
          return returnVal;
        }
        if (scope.startsWith(systemCdnUrl)) {
          opts.system = true;
          return returnVal;
        }

        for (const val of Object.values(inMap.scopes[scope])) {
          if (val?.startsWith(esmCdnUrl)) {
            opts.esm = true;
            return returnVal;
          }
          if (val?.startsWith(systemCdnUrl)) {
            opts.system = true;
            return returnVal;
          }
        }
      }
    }
    if (inMap.depcache) {
      for (const url of Object.keys(inMap.depcache)) {
        if (url.startsWith(esmCdnUrl)) {
          opts.esm = true;
          return returnVal;
        }
        if (url.startsWith(systemCdnUrl)) {
          opts.system = true;
          return returnVal;
        }
      }
    }
    opts.esm = true;
  }
  return returnVal;
}

function startSpinnerLog (log: boolean | string) {
  let spinner;
  if (!log) {
    spinner = ora({
      color: 'yellow',
      spinner: {
        interval: isCygwin() ? 7 : 100,
        frames: (<any>[".   ", ".   ", "..  ", "..  ", "... ", "... ", " ...", " ...", "  ..", "  ..", "   .", "   .", "    ", "    ", "    ", "    "].map(x => isCygwin() ? [x, x, x, x, x, x, x, x, x, x] : x)).flat()
      }
    });
    (async () => {
      for await (const log of logStream()) {
        if (log.type === 'info') {
          const spinning = spinner.isSpinning;
          if (spinning)
            spinner.stop();
          console.error(`${chalk.cyan('info')} ${log.message}`);
          if (spinning)
            spinner.start();
        }
        else if (log.type === 'warn') {
          const spinning = spinner.isSpinning;
          if (spinning)
            spinner.stop();
          console.error(`${chalk.yellow('warn')} ${log.message}`);
          if (spinning)
            spinner.start();
        }
      }
    })().catch(e => {
      throw `${chalk.bold.red('err')}  ${e.message}`;
    });
    spinner.start();
  }
  else {
    (async () => {
      const debugTypes = typeof log === 'string' ? log.split(',') : [];
      for await (const log of logStream()) {
        if (log.type === 'info') {
          console.error(`${chalk.cyan('info')} ${log.message}`);
        }
        else if (log.type === 'warn') {
          console.error(`${chalk.yellow('warn')} ${log.message}`);
        }
        else if (debugTypes.length === 0 || debugTypes.indexOf(log.type) !== -1) {
          console.error(`${chalk.gray(log.type)}: ${log.message}`);
        }
      }
    })().catch(e => {
      throw `${chalk.bold.red('err')}  ${e.message}`;
    });
  }
  return spinner;
}

async function locate (pkg: string, { system = false, conditions = undefined, offline = false }: { system: boolean, conditions?: string[] | undefined, offline: boolean }): Promise<string> {
  const installer = new Installer(new TraceMap(pathToFileURL(process.cwd()), undefined, conditions), { system, offline });
  const { target, subpath } = parsePackageTarget(pkg);
  const resolved = await installer.resolveLatestTarget(target);
  const exports = await installer.resolveExports(pkgToUrl(resolved, esmCdnUrl), false);
  if (subpath === './') {
    return pkgToUrl(resolved, system ? systemCdnUrl : esmCdnUrl) + '/';
  }
  else {
    const exportsMatch = getMapMatch(subpath, exports);
    if (!exportsMatch)
      throw `No exports match for ${subpath} in ${pkgToStr(resolved)}`;
    if (exports[exportsMatch] === null)
      throw `No resolution for ${subpath} with the ${(conditions || ['browser', 'development']).join(', ')} conditions for ${pkgToStr(resolved)}`;
    return pkgToUrl(resolved, system ? systemCdnUrl : esmCdnUrl) + exports[exportsMatch].slice(2);
  }
}

function readFlags (rawArgs: string[], { boolFlags = [], strFlags = [], arrFlags = [], aliases = {} }: { boolFlags: string[], strFlags: string[], arrFlags: string[], aliases: Record<string, string>, err?: string }) {
  function toCamelCase (name) {
    return name.split('-').map((part, i) => i === 0 ? part : part[0].toUpperCase() + part.slice(1)).join('');
  }
  const args: string[] = [], opts: Record<string, string | string[] | boolean> = {};
  let readArg: string | null = null, maybeBool: any = false;
  for (const arg of rawArgs) {
    if (readArg) {
      if (arg.startsWith('-')) {
        if (!maybeBool)
          throw `Flag value for ${chalk.bold(`--${readArg}`)} not specified`;
      }
      else {
        if (Array.isArray(opts[readArg]))
          (<string[]>opts[readArg]).push(arg);
        else
          opts[readArg] = arg;
        readArg = null;
        continue;
      }
    }
    if (arg.startsWith('--')) {
      const eqIndex = arg.indexOf('=');
      const boolFlag = boolFlags.includes(arg.substr(2));
      const strFlag = strFlags.includes(arg.slice(2, eqIndex === -1 ? arg.length : eqIndex));
      const arrFlag = arrFlags.includes(arg.slice(2, eqIndex === -1 ? arg.length : eqIndex));
      if (boolFlag) {
        opts[toCamelCase(arg.substr(2))] = true;
      }
      else if (strFlag || arrFlag) {
        if (eqIndex === -1) {
          readArg = toCamelCase(arg.slice(2));
          if (arrFlag)
            opts[<string>readArg] = opts[<string>readArg] || [];
          maybeBool = boolFlag;
        }
        else {
          if (arrFlag)
            (<string[]>(opts[toCamelCase(arg.slice(2, eqIndex))])).push(arg.slice(eqIndex + 1));
          else
            opts[toCamelCase(arg.slice(2, eqIndex))] = arg.slice(eqIndex + 1);
        }
      }
      else {
        throw `Unknown flag ${chalk.bold(arg)}`;
      }
    }
    else if (arg.startsWith('-')) {
      const hasEq = arg[2] === '=';
      const alias = aliases[arg.slice(1, 2)];
      const boolFlag = alias && !hasEq && boolFlags.find(f => f === alias);
      const strFlag = strFlags.find(f => f === alias);
      const arrFlag = arrFlags.find(f => f === alias);
      if (boolFlag) {
        opts[toCamelCase(boolFlag)] = true;
        for (const c of arg.slice(2)) {
          const alias = aliases[c];
          const boolFlag = alias && boolFlags.find(f => f === alias);
          if (!boolFlag) {
            throw `Unknown boolean flag ${chalk.bold(c)} in set ${arg}`;
          }
          opts[toCamelCase(boolFlag)] = true;
        }
      }
      if (strFlag || arrFlag) {
        if (arrFlag)
          opts[toCamelCase(arrFlag)] = opts[toCamelCase(arrFlag)] || [];

        if (arg.length === 2) {
          readArg = toCamelCase(strFlag || arrFlag);
          maybeBool = boolFlag;
        }
        else {
          if (arrFlag)
            (<string[]>opts[toCamelCase(arrFlag)]).push(arg.slice(2 + (hasEq ? 1 : 0)));
          else
            opts[toCamelCase(strFlag)] = arg.slice(2 + (hasEq ? 1 : 0));
        }
      }
      if (!boolFlag && !strFlag && !arrFlag)
        throw `Unknown flag ${chalk.bold(arg)}`;
    }
    else {
      args.push(arg);
    }
  }
  if (readArg && !maybeBool)
    throw `Flag value for ${chalk.bold(`--${readArg}`)} not specified`;
  return { args, opts };
}

let _isCygwin;
function isCygwin () {
  if (typeof _isCygwin === 'boolean')
    return _isCygwin;
  try {
    if (require('child_process').execSync('uname -s', { stdio: 'pipe' }).toString().match(/^(CYGWIN|MINGW32|MINGW64)/))
      return _isCygwin = true;
  }
  catch (e) {}
  return _isCygwin = false;
}

function output (str: string, opts: any) {
  if (opts.copy) {
    process.stdout.write(`${str}\n${chalk.bold('(Result copied to clipboard)')}`);
    clipboardy.writeSync(str);
  }
  else {
    process.stdout.write(str + '\n');
  }
}
