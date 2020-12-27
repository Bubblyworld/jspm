import { InstallOptions, InstallTarget } from "../install/installer.ts";
import { baseUrl, importedFrom, isPlain } from "../common/url.ts";
import { Installer } from "../install/installer.ts";
import { log } from "../common/log.ts";
import { JspmError, throwInternalError } from "../common/err.ts";
import { parsePkg } from "../install/package.ts";
import { getMapMatch, getScopeMatches, IImportMap, ImportMap } from "./map.ts";
import resolver from "../install/resolver.ts";
import { DependenciesField, updatePjson } from "./pjson.ts";
import { fileURLToPath } from 'url';
import path from 'path';
import { builtinSet } from "../install/installer.ts";

export interface TraceMapOptions extends InstallOptions {
  env?: string[];

  inMap?: IImportMap;
  // whether to generate an import map of the install trace
  importMap?: boolean;
  // whether to generate depcache on the import map of the install trace
  depcache?: boolean;
  // whether to support system tracing (in MapOptions this does system post-conversion too)
  system?: boolean;
  // do not trace dynamic imports
  static?: boolean;

  // whether to permit new install into the lockfile
  install?: boolean;

  // whether the install is a full dependency install
  // or simply a trace install
  fullInstall?: boolean;

  // whether the import map is a full generic import map for the app
  // or an exact trace for the provided entry points
  fullMap?: boolean;

  // (installType: 'trace' + mapType: 'full' currently unsupported)

  // save flags
  save?: boolean;
  saveDev?: boolean;
  savePeer?: boolean;
  saveOptional?: boolean;
}

interface TraceGraph {
  [tracedUrls: string]: TraceEntry;
}

interface TraceEntry {
  deps: Record<string, string>;
  dynamicDeps: Record<string, string[]>;
  // assetDeps: { expr: string, start: number, end: number, assets: string[] }
  hasStaticParent: boolean;
  size: number;
  integrity: string;
  system: boolean;
}

// The tracemap fully drives the installer
export default class TraceMap {
  env = ['browser', 'development'];
  installer: Installer | undefined;
  opts: TraceMapOptions;
  tracedUrls: TraceGraph = {};
  map: ImportMap;
  mapBase: URL;
  pjsonBase: URL | undefined;
  entryTraces = new Set<string>();
  added = new Map<string, InstallTarget>();
  pjson: any | undefined;

  constructor (mapBase: URL, opts: TraceMapOptions) {
    this.mapBase = mapBase;
    this.opts = opts;
    if (this.opts.env)
      this.env = this.opts.env;
    if (opts.inMap)
      this.map = opts.inMap instanceof ImportMap ? opts.inMap : new ImportMap(mapBase).extend(opts.inMap);
    else
      this.map = new ImportMap(mapBase);
  }

  async visit (url: string, visitor: (url: string, entry: TraceEntry) => Promise<boolean | void>, seen = new Set()) {
    if (seen.has(url))
      return;
    seen.add(url);
    const entry = this.tracedUrls[url];
    if (!entry)
      return;
    for (const dep of Object.keys(entry.deps)) {
      await this.visit(entry.deps[dep], visitor, seen);
    }
    await visitor(url, entry);
  }

  async startInstall () {
    this.pjsonBase = this.pjsonBase || new URL((await resolver.getPackageBase(this.mapBase.href)) || baseUrl.href);
    if (!this.installer) {
      if (!this.pjsonBase)
        log('warn', 'No project package.json found, create a package.json file to define install resolution targets for updating or publishing.');
      this.installer = new Installer(this.pjsonBase || baseUrl, this.opts);
    }

    const finishInstall = await this.installer.startInstall();

    return async (success: boolean) => {
      if (!success) {
        finishInstall(false);
        return false;
      }

      // re-drive all the traces to convergence
      if (!this.opts.fullMap) {
        const modules: Record<string, string> = {};
        do {
          this.installer!.newInstalls = false;
          await Promise.all([...this.entryTraces].map(async trace => {
            const [specifier, parentUrl] = trace.split('##');
            const resolved = await this.trace(specifier, new URL(parentUrl));
            modules[resolved] = specifier;
          }));
        } while (this.installer!.newInstalls);

        // now second-pass visit the trace to gather the exact graph and collect the import map
        const discoveredDynamics = new Set<string>();
        const depVisitor = async (url: string, entry: TraceEntry) => {
          const parentPkgUrl = await resolver.getPackageBase(url);
          for (const dep of Object.keys(entry.dynamicDeps)) {
            const resolvedUrl = entry.dynamicDeps[dep][0];
            if (isPlain(dep))
              this.map.addMapping(dep, resolvedUrl, parentPkgUrl);
            discoveredDynamics.add(resolvedUrl);
          }
          for (const dep of Object.keys(entry.deps)) {
            if (isPlain(dep))
              this.map.addMapping(dep, entry.deps[dep], parentPkgUrl);
          }
        }

        for (const [url, specifier] of Object.entries(modules)) {
          if (isPlain(specifier))
            this.map.addMapping(specifier, url, this.mapBase.href);
          await this.visit(url, depVisitor);
        }

        const seen = new Set<string>();
        for (const url of discoveredDynamics) {
          await this.visit(url, depVisitor, seen);
        }
      }

      // update the package.json dependencies
      let pjsonChanged = false;
      let saveField: DependenciesField | null = this.opts.save ? 'dependencies' : this.opts.saveDev ? 'devDependencies' : this.opts.savePeer ? 'peerDependencies' : this.opts.saveOptional ? 'optionalDependencies' : null;
      if (saveField) {
        pjsonChanged = await updatePjson(this.pjsonBase!, async pjson => {
          pjson[saveField!] = pjson[saveField!] || {};
          for (const [name, target] of this.added) {
            if (target instanceof URL) {
              if (target.protocol === 'file:') {
                pjson[saveField!]![name] = 'file:' + path.relative(fileURLToPath(this.pjsonBase), fileURLToPath(target));
              }
              else {
                pjson[saveField!]![name] = target.href;
              }
            }
            else {
              let versionRange = target.ranges.map(range => range.toString()).join(' || ');
              if (versionRange === '*') {
                const pcfg = await resolver.getPackageConfig(this.installer!.installs[this.pjsonBase!.href][target.name]);
                if (pcfg)
                  versionRange = '^' + pcfg?.version;
              }
              pjson[saveField!]![name] = (target.name === name ? '' : target.registry + ':' + target.name + '@') + versionRange;
            }
          }
        });
      }

      // prune the lockfile to the include traces only
      // this is done after pjson updates to include any adds
      if (this.opts.fullInstall) {
        const deps = await resolver.getDepList(this.pjsonBase!.href, true);
        // existing deps is any existing builtin resolutions
        const existingBuiltins = new Set(Object.keys(this.installer!.installs[this.pjsonBase!.href] || {}).filter(name => builtinSet.has(name)));
        const installs = await this.installer!.lockInstall([...new Set([...deps, ...existingBuiltins])], this.pjsonBase!.href, true);

        // construct the full map
        if (this.opts.fullMap) {
          // add all builtins as top-level imports if not in existing deps
          for (const pkgName of builtinSet) {
            if (pkgName[0] === '_' || existingBuiltins.has(pkgName) || deps.includes(pkgName))
              continue;
            const resolution = await this.installer!.install(pkgName, this.pjsonBase!.href);
            this.addAllPkgMappings(pkgName, resolution, this.env, null);
          }
          await Promise.all(installs.map(async ([name, pkgUrl]) => {
            await this.addAllPkgMappings(name, this.installer!.installs[pkgUrl][name], this.env, pkgUrl === this.mapBase!.href ? null : pkgUrl);
          }));
        }
      }

      return finishInstall(true) || pjsonChanged;
    };
  }

  async add (name: string, target: InstallTarget): Promise<string> {
    const installed = await this.installer!.installTarget(name, target, this.mapBase.href);
    this.added.set(name, target);
    return installed.slice(0, -1);
  }

  async addAllPkgMappings (name: string, pkgUrl: string, env: string[], parentPkgUrl: string | null) {
    const [url, subpathFilter] = pkgUrl.split('|');
    const exports = await resolver.resolveExports(url + (url.endsWith('/') ? '' : '/'), env, subpathFilter);
    for (const key of Object.keys(exports)) {
      if (key.endsWith('!cjs'))
        continue;
      if (!exports[key])
        continue;
      if (key.endsWith('*'))
        continue;
      this.map.addMapping(name + key.slice(1), new URL(exports[key], url).href, parentPkgUrl);
    }
  }

  async trace (specifier: string, parentUrl: URL = this.mapBase, env = this.env): Promise<string> {
    const parentPkgUrl = await resolver.getPackageBase(parentUrl.href);
    if (!parentPkgUrl)
      throwInternalError();

    this.entryTraces.add(specifier + '##' + parentUrl.href);

    if (!isPlain(specifier)) {
      const resolvedUrl = new URL(specifier, parentUrl);
      if (resolvedUrl.protocol !== 'file:' && resolvedUrl.protocol !== 'https:' && resolvedUrl.protocol !== 'http:' && resolvedUrl.protocol !== 'node:' && resolvedUrl.protocol !== 'data:')
        throw new JspmError(`Found unexpected protocol ${resolvedUrl.protocol}${importedFrom(parentUrl)}`);
      log('trace', `${specifier} ${parentUrl.href} -> ${resolvedUrl}`);
      await this.traceUrl(resolvedUrl.href, parentUrl, env);
      return resolvedUrl.href;
    }
  
    const parsed = parsePkg(specifier);
    if (!parsed) throw new JspmError(`Invalid package name ${specifier}`);
    const { pkgName, subpath } = parsed;
  
    // Subscope override
    const scopeMatches = getScopeMatches(parentUrl, this.map.scopes, this.map.baseUrl);
    const pkgSubscopes = scopeMatches.filter(([, url]) => url.startsWith(parentPkgUrl));
    if (pkgSubscopes.length) {
      for (const [scope] of pkgSubscopes) {
        const mapMatch = getMapMatch(specifier, this.map.scopes[scope]);
        if (mapMatch) {
          const resolved = new URL(this.map.scopes[scope][mapMatch] + specifier.slice(mapMatch.length), this.map.baseUrl).href;
          log('trace', `${specifier} ${parentUrl.href} -> ${resolved}`);
          await this.traceUrl(resolved, parentUrl, env);
          return resolved;
        }
      }
    }
  
    // Scope override
    const userScopeMatch = scopeMatches.find(([, url]) => url === parentPkgUrl);
    if (userScopeMatch) {
      const imports = this.map.scopes[userScopeMatch[0]];
      const userImportsMatch = getMapMatch(specifier, imports);
      const userImportsResolved = userImportsMatch ? new URL(imports[userImportsMatch] + specifier.slice(userImportsMatch.length), this.map.baseUrl).href : null;
      if (userImportsResolved) {
        log('trace', `${specifier} ${parentUrl.href} -> ${userImportsResolved}`);
        await this.traceUrl(userImportsResolved, parentUrl, env);
        return userImportsResolved;
      }
    }

    const installed = !this.opts.install ? this.installer?.installs[parentPkgUrl]?.[pkgName] : await this.installer?.install(pkgName, parentPkgUrl, parentUrl.href);
    if (installed) {
      let [pkgUrl, subpathFilter] = installed.split('|');
      if (subpathFilter)
        pkgUrl += '/';
      const exports = await resolver.resolveExports(pkgUrl, this.env, subpathFilter);
      const match = getMapMatch(subpath, exports);
      if (!match)
        throw new JspmError(`No '${subpath}' exports subpath defined in ${pkgUrl} resolving ${pkgName}${importedFrom(parentUrl)}.`);
      if (match) {
        const resolved = new URL(exports[match] + subpath.slice(match.length), pkgUrl).href;
        log('trace', `${specifier} ${parentUrl.href} -> ${resolved}`);
        await this.traceUrl(resolved, parentUrl, env);
        return resolved;
      }
    }
  
    // User import overrides
    const userImportsMatch = getMapMatch(specifier, this.map.imports);
    const userImportsResolved = userImportsMatch ? new URL(this.map.imports[userImportsMatch] + specifier.slice(userImportsMatch.length), this.map.baseUrl).href : null;
    if (userImportsResolved) {
      log('trace', `${specifier} ${parentUrl.href} -> ${userImportsResolved}`);
      await this.traceUrl(userImportsResolved, parentUrl, env);
      return userImportsResolved;
    }

    throw new JspmError(`No resolution in map for ${specifier}${importedFrom(parentUrl)}`);
  }

  private async traceUrl (resolvedUrl: string, parentUrl: URL, env: string[]): Promise<void> {
    if (resolvedUrl in this.tracedUrls) return;
    if (resolvedUrl.endsWith('/'))
      throw new JspmError(`Trailing "/" installs not yet supported installing ${resolvedUrl} for ${parentUrl.href}`);
    const traceEntry: TraceEntry = this.tracedUrls[resolvedUrl] = {
      deps: Object.create(null),
      dynamicDeps: Object.create(null),
      hasStaticParent: true,
      size: NaN,
      integrity: '',
      system: false
    };
    const { deps, dynamicDeps, integrity, size, system } = await resolver.analyze(resolvedUrl, parentUrl, this.opts.system);
    traceEntry.integrity = integrity;
    traceEntry.system = !!system;
    traceEntry.size = size;
    
    let allDeps: string[] = deps;
    if (dynamicDeps.length && !this.opts.static) {
      allDeps = [...deps];
      for (const dep of dynamicDeps) {
        if (!allDeps.includes(dep))
          allDeps.push(dep);
      }
    }
    const resolvedUrlObj = new URL(resolvedUrl);
    await Promise.all(allDeps.map(async dep => {
      const resolvedUrl = await this.trace(dep, resolvedUrlObj, env);
      if (deps.includes(dep))
        traceEntry.deps[dep] = resolvedUrl;
      if (dynamicDeps.includes(dep))
        traceEntry.dynamicDeps[dep] = [resolvedUrl];
    }));
  }
}
