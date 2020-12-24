import { ExactPackage, PackageConfig, PackageTarget, parseCdnPkg, pkgToUrl, ExportsTarget } from './package.ts';
import { JspmError, throwInternalError } from '../common/err.ts';
import { log } from '../common/log.ts';
import { fetch } from '../common/fetch.ts';
import { importedFrom } from "../common/url.ts";
import { computeIntegrity } from "../common/integrity.ts";
import { parse } from 'es-module-lexer';

export function pkgToLookupUrl (pkg: ExactPackage, edge = false) {
  return `https://ga.jspm.io/${pkg.registry}:${pkg.name}${pkg.version != undefined ? '@' + pkg.version : edge ? '@' : ''}`;
}

export const cdnUrls = ['https://ga.jspm.io/', 'https://system.jspm.io/', 'https://deno.land/x/', 'https://deno.land/'];
export class Resolver {
  resolveCache: Record<string, {
    latest: Promise<ExactPackage | null>;
    majors: Record<string, Promise<ExactPackage | null>>;
    minors: Record<string, Promise<ExactPackage | null>>;
    tags: Record<string, Promise<ExactPackage | null>>;
  }> = {};
  pcfgPromises: Record<string, Promise<void>> = Object.create(null);
  pcfgs: Record<string, PackageConfig | null> = Object.create(null);
  fetchOpts: any;
  constructor (fetchOpts?: any) {
    this.fetchOpts = fetchOpts;
  }

  async getPackageBase (url: string) {
    const cdnPkg = parseCdnPkg(url, cdnUrls);
    if (cdnPkg)
      return pkgToUrl(cdnPkg.pkg, cdnPkg.cdnUrl);
  
    if (url.startsWith('node:'))
      return url;
    
    let testUrl = new URL('./', url);
    do {
      let responseUrl;
      if (responseUrl = await resolver.checkPjson(testUrl.href))
        return new URL('.', responseUrl).href;
      if (testUrl.pathname === '/')
        return testUrl.href;
    } while (testUrl = new URL('../', testUrl));
  }

  async getPackageConfig (pkgUrl: string): Promise<PackageConfig | null> {
    if (!pkgUrl.endsWith('/'))
      throw new Error(`Internal Error: Package URL must end in "/". Got ${pkgUrl}`);
    let cached = this.pcfgs[pkgUrl];
    if (cached) return cached;
    if (!this.pcfgPromises[pkgUrl])
      this.pcfgPromises[pkgUrl] = (async () => {
        const res = await fetch(`${pkgUrl}package.json`, this.fetchOpts);
        switch (res.status) {
          case 200:
          case 304:
            break;
          case 404:
          case 406:
            this.pcfgs[pkgUrl] = null;
            return;
          default:
            throw new JspmError(`Invalid status code ${res.status} reading package config for ${pkgUrl}. ${res.statusText}`);
        }
        if (res.headers && !res.headers.get('Content-Type')?.match(/^application\/json(;|$)/)) {
          this.pcfgs[pkgUrl] = null;
        }
        else try {
          this.pcfgs[pkgUrl] = await res.json();
        }
        catch (e) {
          this.pcfgs[pkgUrl] = null;
        }
      })();
    await this.pcfgPromises[pkgUrl];
    return this.pcfgs[pkgUrl];
  }

  async getDepList (pkgUrl: string, dev = false): Promise<string[]> {
    const pjson = (await this.getPackageConfig(pkgUrl))!;
    if (!pjson)
      return [];
    return [...new Set([
      Object.keys(pjson.dependencies || {}),
      Object.keys(dev && pjson.devDependencies || {}),
      Object.keys(pjson.peerDependencies || {}),
      Object.keys(pjson.optionalDependencies || {})
    ].flat())];
  }

  async checkPjson (url: string): Promise<string | false> {
    if (await this.getPackageConfig(url) === null)
      return false;
    return url;
  }

  async exists (resolvedUrl: string) {
    const res = await fetch(resolvedUrl, this.fetchOpts);
    switch (res.status) {
      case 200:
      case 304:
        return true;
      case 404:
      case 406:
        return false;
      default: throw new JspmError(`Invalid status code ${res.status} loading ${resolvedUrl}. ${res.statusText}`);
    }
  }

  async resolveLatestTarget (target: PackageTarget, parentUrl?: string | URL): Promise<ExactPackage> {
    const { registry, name, ranges } = target;

    // exact version optimization
    if (ranges.length === 1 && ranges[0].isExact && !ranges[0].version.tag)
      return { registry, name, version: ranges[0].version.toString() };

    const cache = this.resolveCache[target.registry + ':' + target.name] = this.resolveCache[target.registry + ':' + target.name] || {
      latest: null,
      majors: Object.create(null),
      minors: Object.create(null),
      tags: Object.create(null)
    };
    
    for (const range of ranges.reverse()) {
      if (range.isWildcard) {
        let lookup = await (cache.latest || (cache.latest = this.lookupRange(registry, name, '', parentUrl)));
        // Deno wat?
        if (lookup instanceof Promise)
          lookup = await lookup;
        if (lookup) {
          if (lookup instanceof Promise)
            throwInternalError();
          log('resolve', `${target.registry}:${target.name}@${target.ranges.map(range => range.toString()).join('|')} -> WILDCARD ${lookup.version}${parentUrl ? ' [' + parentUrl + ']' : ''}`);
          return lookup;
        }
      }
      else if (range.isExact && range.version.tag) {
        const tag = range.version.tag;
        let lookup = await (cache.tags[tag] || (cache.tags[tag] = this.lookupRange(registry, name, tag, parentUrl)));
        // Deno wat?
        if (lookup instanceof Promise)
        lookup = await lookup;
        if (lookup) {
          if (lookup instanceof Promise)
            throwInternalError();
          log('resolve', `${target.registry}:${target.name}@${target.ranges.map(range => range.toString()).join('|')} -> TAG ${tag}${parentUrl ? ' [' + parentUrl + ']' : ''}`);
          return lookup;
        }
      }
      else if (range.isMajor) {
        const major = range.version.major;
        let lookup = await (cache.majors[major] || (cache.majors[major] = this.lookupRange(registry, name, major, parentUrl)));
        // Deno wat?
        if (lookup instanceof Promise)
          lookup = await lookup;
        if (lookup) {
          if (lookup instanceof Promise)
            throwInternalError();
          log('resolve', `${target.registry}:${target.name}@${target.ranges.map(range => range.toString()).join('|')} -> MAJOR ${lookup.version}${parentUrl ? ' [' + parentUrl + ']' : ''}`);
          return lookup;
        }
      }
      else if (range.isStable) {
        const minor = `${range.version.major}.${range.version.minor}`;
        let lookup = await (cache.minors[minor] || (cache.minors[minor] = this.lookupRange(registry, name, minor, parentUrl)));
        // Deno wat?
        if (lookup instanceof Promise)
          lookup = await lookup;
        if (lookup) {
          if (lookup instanceof Promise)
            throwInternalError();
          log('resolve', `${target.registry}:${target.name}@${target.ranges.map(range => range.toString()).join('|')} -> MINOR ${lookup.version}${parentUrl ? ' [' + parentUrl + ']' : ''}`);
          return lookup;
        }
      }
    }
    throw new JspmError(`Unable to resolve package ${registry}:${name} to "${ranges.join(' || ')}"${importedFrom(parentUrl)}`);
  }
  
  private async lookupRange (registry: string, name: string, range: string, parentUrl?: string | URL): Promise<ExactPackage | null> {
    const res = await fetch(pkgToLookupUrl({ registry, name, version: range }), this.fetchOpts);
    switch (res.status) {
      case 304: case 200: return { registry, name, version: (await res.text()).trim() };
      case 404: return null;
      default: throw new JspmError(`Invalid status code ${res.status} looking up "${registry}:${name}" - ${res.statusText}${importedFrom(parentUrl)}`);
    }
  }

  async resolveExports (pkgUrl: string, env: string[], subpathFilter?: string): Promise<Record<string, string>> {
    const pcfg = await this.getPackageConfig(pkgUrl) || {};

    // conditional resolution from conditions
    // does in-browser package resolution
    // index.js | index.json
    // main[.js|.json|.node|'']
    // 
    // Because of extension checks on CDN, we do .js|.json|.node FIRST (if not already one of those extensions)
    // all works out
    // exports are exact files
    // done
    const exports = Object.create(null);
    if (pcfg.exports !== undefined && pcfg.exports !== null) {
      function allDotKeys (exports: Record<string, any>) {
        for (let p in exports) {
          if (p[0] !== '.')
            return false;
        }
        return true;
      }
      if (typeof pcfg.exports === 'string') {
        exports['.'] = pcfg.exports;
      }
      else if (!allDotKeys(pcfg.exports)) {
        exports['.'] = getExportsTarget(pcfg.exports, env);
      }
      else {
        for (const expt of Object.keys(pcfg.exports)) {
          exports[expt] = getExportsTarget((pcfg.exports as Record<string, ExportsTarget>)[expt], env);
        }
      }
    }
    else {
      if (typeof pcfg.browser === 'string') {
        exports['.'] = pcfg.browser.startsWith('./') ? pcfg.browser : './' + pcfg.browser;
      }
      else if (typeof pcfg.main === 'string') {
        exports['.'] = pcfg.main.startsWith('./') ? pcfg.main : './' + pcfg.main;
      }
      if (typeof pcfg.browser === 'object') {
        for (const subpath of Object.keys(pcfg.browser)) {
          if (subpath.startsWith('./')) {
            if (exports['.'] === subpath)
              exports['.'] = pcfg.browser[subpath];
            exports[subpath] = pcfg.browser[subpath];
          }
          else {
            log('todo', `Non ./ subpaths in browser field: ${pcfg.name}.browser['${subpath}'] = ${pcfg.browser[subpath]}`);
          }
        }
      }
      if (!exports['./'])
        exports['./'] = './';
      if (!exports['.'])
        exports['.'] = '.';
    }

    if (subpathFilter) {
      subpathFilter = './' + subpathFilter;
      const filteredExports = Object.create(null);
      for (const key of Object.keys(exports)) {
        if (key.startsWith(subpathFilter) && (key.length === subpathFilter.length || key[subpathFilter.length] === '/')) {
          filteredExports['.' + key.slice(subpathFilter.length)] = exports[key];
        }
        else if (key.endsWith('*')) {
          const patternBase = key.slice(0, -1);
          if (subpathFilter.startsWith(patternBase)) {
            const replacement = subpathFilter.slice(patternBase.length);
            filteredExports['.'] = replaceTargets(exports[key], replacement);
            filteredExports['./*'] = replaceTargets(exports[key], replacement + '/*');
          }
        }
      }
      function replaceTargets (target: ExportsTarget, replacement: string): ExportsTarget {
        if (Array.isArray(target)) {
          return [...target.map(target => replaceTargets(target, replacement))];
        }
        else if (typeof target === 'object' && target !== null) {
          const newTarget: Record<string, ExportsTarget> = {};
          for (const key of Object.keys(target))
            newTarget[key] = replaceTargets(target[key], replacement);
          return newTarget;
        }
        else if (typeof target === 'string') {
          return target.replace(/\*/g, replacement);
        }
        return target;
      }
      return filteredExports;
    }

    return exports;
  }

  async getIntegrity (url: string, offline: boolean) {
    const res = await fetch(url, offline ? { cache: 'only-if-cached' } : {});
    switch (res.status) {
      case 200: case 304: break;
      case 404: throw new Error(`URL ${url} not found.`);
      default: throw new Error(`Invalid status code ${res.status} requesting ${url}. ${res.statusText}`);
    }
    return computeIntegrity(await res.text());
  }

  async analyze (resolvedUrl: string, parentUrl?: URL, system = false): Promise<Analysis> {
    const res = await fetch(resolvedUrl, this.fetchOpts);
    switch (res.status) {
      case 200:
      case 304:
        break;
      case 404: throw new JspmError(`Module not found: ${resolvedUrl}${importedFrom(parentUrl)}`);
      default: throw new JspmError(`Invalid status code ${res.status} loading ${resolvedUrl}. ${res.statusText}`);
    }
    let source = await res.text();
    try {
      const [imports] = await parse(source);
      return system ? createSystemAnalysis(source, imports, resolvedUrl) : createEsmAnalysis(imports, source, resolvedUrl);
    }
    catch (e) {
      if (!e.message || !e.message.startsWith('Parse error @:'))
        throw e;
      // fetch is _unstable_!!!
      // so we retry the fetch first
      const res = await fetch(resolvedUrl, this.fetchOpts);
      switch (res.status) {
        case 200:
        case 304:
          break;
        case 404: throw new JspmError(`Module not found: ${resolvedUrl}${importedFrom(parentUrl)}`);
        default: throw new JspmError(`Invalid status code ${res.status} loading ${resolvedUrl}. ${res.statusText}`);
      }
      source = await res.text();
      try {
        const [imports] = await parse(source);
        return system ? createSystemAnalysis(source, imports, resolvedUrl) : createEsmAnalysis(imports, source, resolvedUrl);
      }
      catch (e) {
        // TODO: better parser errors
        if (e.message && e.message.startsWith('Parse error @:')) {
          const pos = e.message.slice(14, e.message.indexOf('\n'));
          let [line, col] = pos.split(':');
          const lines = source.split('\n');
          // console.log(source);
          if (line > 1)
            console.log('  ' + lines[line - 2]);
          console.log('> ' + lines[line - 1]);
          console.log('  ' + ' '.repeat(col - 1) + '^');
          if (lines.length > 1)
            console.log('  ' + lines[line]);
          throw new JspmError(`Error parsing ${resolvedUrl}:${pos}`);
        }
        throw e;
      }
    }
  }
}

export function getExportsTarget(target: ExportsTarget, env: string[]): string | null {
  if (typeof target === 'string') {
    return target;
  }
  else if (typeof target === 'object' && target !== null && !Array.isArray(target)) {
    for (const condition in target) {
      if (condition === 'default' || env.includes(condition)) {
        const resolved = getExportsTarget(target[condition], env);
        if (resolved)
          return resolved;
      }
    }
  }
  else if (Array.isArray(target)) {
    // TODO: Validation for arrays
    for (const targetFallback of target) {
      return getExportsTarget(targetFallback, env);
    }
  }
  return null;
}

interface Analysis {
  deps: string[],
  dynamicDeps: string[],
  size: number,
  integrity: string,
  system?: boolean
}

function createEsmAnalysis (imports: any, source: string, url: string): Analysis {
  if (!imports.length && registerRegEx.test(source))
    return createSystemAnalysis(source, imports, url);
  const deps: string[] = [];
  const dynamicDeps: string[] = [];
  for (const impt of imports) {
    if (impt.d === -1) {
      deps.push(source.slice(impt.s, impt.e));
      continue;
    }
    // dynamic import -> deoptimize trace all dependencies (and all their exports)
    if (impt.d >= 0) {
      const dynExpression = source.slice(impt.s, impt.e);
      if (dynExpression.startsWith('"') || dynExpression.startsWith('\'')) {
        try {
          dynamicDeps.push(JSON.parse('"' + dynExpression.slice(1, -1) + '"'));
        }
        catch (e) {
          console.warn('TODO: Dynamic import custom expression tracing.');
        }
      }
    }
  }
  const size = source.length;
  return { deps, dynamicDeps, size, integrity: computeIntegrity(source), system: false };
}

const registerRegEx = /^\s*(\/\*[^\*]*(\*(?!\/)[^\*]*)*\*\/|\s*\/\/[^\n]*)*\s*System\s*\.\s*register\s*\(\s*(\[[^\]]*\])\s*,\s*\(?function\s*\(\s*([^\),\s]+\s*(,\s*([^\),\s]+)\s*)?\s*)?\)/;
function createSystemAnalysis (source: string, imports: string[], url: string): Analysis {
  const [, , , rawDeps, , , contextId] = source.match(registerRegEx) || [];
  if (!rawDeps)
    return createEsmAnalysis(imports, source, url);
  const deps = JSON.parse(rawDeps.replace(/'/g, '"'));
  const dynamicDeps: string[] = [];
  if (contextId) {
    const dynamicImport = `${contextId}.import(`;
    let i = -1;
    while ((i = source.indexOf(dynamicImport, i + 1)) !== -1) {
      const importStart = i + dynamicImport.length + 1;
      const quote = source[i + dynamicImport.length];
      if (quote === '"' || quote === '\'') {
        const importEnd = source.indexOf(quote, i + dynamicImport.length + 1);
        if (importEnd !== -1) {
          try {
            dynamicDeps.push(JSON.parse('"' + source.slice(importStart, importEnd) + '"'));
            continue;
          }
          catch (e) {}
        }
      }
      console.warn('TODO: Dynamic import custom expression tracing.');
    }
  }
  const size = source.length;
  return { deps, dynamicDeps, size, integrity: computeIntegrity(source), system: true };
}

let resolver = new Resolver();

export function newResolver (fetchOpts?: any) {
  resolver = new Resolver(fetchOpts);
}

export function setOffline (isOffline = true) {
  if (isOffline)
    newResolver({ cache: 'only-if-cached' });
  else
    newResolver();
}

export { resolver as default }