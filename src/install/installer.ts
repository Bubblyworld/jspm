import sver from 'sver';
const { Semver } = sver;
import { log } from '../common/log.ts';
import { builtinModules } from 'module';
import { fileURLToPath } from 'url';
import * as lock from "./lock.ts";
import resolver, { cdnUrls } from "./resolver.ts";
import { ExactPackage, newPackageTarget, PackageTarget, pkgToUrl, parseCdnPkg } from "./package.ts";
import { isURL, importedFrom } from "../common/url.ts";
import { throwInternalError } from "../common/err.ts";
import { DependenciesField, updatePjson } from './pjson.ts';
import path from 'path';

export const builtinSet = new Set<string>(builtinModules);

export interface PackageInstall {
  name: string;
  pkgUrl: string;
}

export interface PackageInstallRange {
  pkg: ExactPackage;
  target: PackageTarget;
  install: PackageInstall;
}

export type InstallTarget = PackageTarget | URL;

export interface InstallOptions {
  // do not modify the lockfile
  freezeLock?: boolean;
  // do not use the lockfile at all
  noLock?: boolean;
  // force use latest versions for everything we touch
  latest?: boolean;

  // if a resolution is not in its expected range
  // / expected URL (usually due to manual user edits),
  // force override a new install
  force?: boolean;
  // stdlib target
  stdlib?: string;

  cdnUrl?: string;

  
  // whether the install is a full dependency install
  // or simply a trace install
  fullInstall?: boolean;

  // save flags
  save?: boolean;
  saveDev?: boolean;
  savePeer?: boolean;
  saveOptional?: boolean;
};

export class Installer {
  opts: InstallOptions;
  installs: lock.LockResolutions;
  installing = false;
  newInstalls = false;
  currentInstall = Promise.resolve();
  stdlibTarget: InstallTarget = new URL('../../core/dist', import.meta.url);
  installBaseUrl: string;
  lockfilePath: string;
  cdnUrl = 'https://ga.jspm.io/';
  added = new Map<string, InstallTarget>();

  constructor (baseUrl: URL, opts: InstallOptions) {
    this.installBaseUrl = baseUrl.href;
    this.opts = opts;
    if (opts.cdnUrl)
      this.cdnUrl = opts.cdnUrl;
    this.lockfilePath = fileURLToPath(this.installBaseUrl + 'jspm.lock');
    const { resolutions } = this.opts.noLock === true ? { resolutions: {} } : lock.loadVersionLock(this.lockfilePath);
    this.installs = resolutions;

    if (opts.stdlib) {
      if (isURL(opts.stdlib) || opts.stdlib[0] === '.') {
        this.stdlibTarget = new URL(opts.stdlib, baseUrl);
        if (this.stdlibTarget.href.endsWith('/'))
          this.stdlibTarget.pathname = this.stdlibTarget.pathname.slice(0, -1);
      }
      else {
        this.stdlibTarget = newPackageTarget(opts.stdlib, this.installBaseUrl);
      }
    }
  }

  async startInstall (): Promise<(success: boolean) => Promise<boolean>> {
    if (this.installing)
      return this.currentInstall.then(() => this.startInstall());
    let finishInstall: (success: boolean) => Promise<boolean>;
    this.installing = true;
    this.newInstalls = false;
    this.added = new Map<string, InstallTarget>();
    this.currentInstall = new Promise(resolve => {
      finishInstall = async (success: boolean) => {
        if (!success) {
          this.installing = false;
          resolve();
          return false;
        }

        // update the package.json dependencies
        let pjsonChanged = false;
        let saveField: DependenciesField | null = this.opts.save ? 'dependencies' : this.opts.saveDev ? 'devDependencies' : this.opts.savePeer ? 'peerDependencies' : this.opts.saveOptional ? 'optionalDependencies' : null;
        if (saveField) {
          pjsonChanged = await updatePjson(this.installBaseUrl, async pjson => {
            pjson[saveField!] = pjson[saveField!] || {};
            for (const [name, target] of this.added) {
              if (target instanceof URL) {
                if (target.protocol === 'file:') {
                  pjson[saveField!]![name] = 'file:' + path.relative(fileURLToPath(this.installBaseUrl), fileURLToPath(target));
                }
                else {
                  pjson[saveField!]![name] = target.href;
                }
              }
              else {
                let versionRange = target.ranges.map(range => range.toString()).join(' || ');
                if (versionRange === '*') {
                  const pcfg = await resolver.getPackageConfig(this.installs[this.installBaseUrl][target.name]);
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
        if (this.opts.fullInstall || pjsonChanged) {
          const deps = await resolver.getDepList(this.installBaseUrl, true);
          // existing deps is any existing builtin resolutions
          const existingBuiltins = new Set(Object.keys(this.installs[this.installBaseUrl] || {}).filter(name => builtinSet.has(name)));
          await this.lockInstall([...new Set([...deps, ...existingBuiltins])], this.installBaseUrl, true);
        }

        console.log(this.opts);
        console.log(JSON.stringify(this.installs, null, 2));
        const changed = this.opts.freezeLock === true || this.opts.noLock === true ||
            lock.saveVersionLock(this.installs, this.lockfilePath) || pjsonChanged;
        this.installing = false;
        resolve();
        return changed;
      };
    });
    return finishInstall!;
  }

  async lockInstall (installs: string[], pkgUrl = this.installBaseUrl, prune = true) {
    const visited = new Set<string>();
    const visitInstall = async (name: string, pkgUrl: string): Promise<void> => {
      if (visited.has(name + '##' + pkgUrl))
        return;
      visited.add(name + '##' + pkgUrl);
      const installUrl = await this.install(name, pkgUrl);
      const installPkgUrl = installUrl.split('|')[0] + (installUrl.indexOf('|') === -1 ? '' : '/');
      const deps = await resolver.getDepList(installPkgUrl);
      const existingDeps = Object.keys(this.installs[installPkgUrl] || {});
      await Promise.all([...new Set([...deps, ...existingDeps])].map(dep => visitInstall(dep, installPkgUrl)));
    };
    await Promise.all(installs.map(install => visitInstall(install, pkgUrl)));
    if (prune) {
      const pruneList: [string, string][] = [...visited].map(item => {
        const [name, pkgUrl] = item.split('##');
        return [name, pkgUrl];
      });
      this.installs = lock.pruneResolutions(this.installs, pruneList);
    }
  }

  replace (target: InstallTarget, replacePkgUrl: string) {
    let targetUrl: string;
    if (target instanceof URL) {
      targetUrl = target.href;
    }
    else {
      const pkg = this.getBestMatch(target);
      if (!pkg)
        throw new Error('No installation found to replace.');
      targetUrl = pkgToUrl(pkg, this.cdnUrl);
    }

    for (const pkgUrl of Object.keys(this.installs)) {
      for (const name of Object.keys(this.installs[pkgUrl])) {
        if (this.installs[pkgUrl][name] === targetUrl) {
          this.newInstalls = true;
          this.installs[pkgUrl][name] = replacePkgUrl;
        }
      }
      if (pkgUrl === targetUrl) {
        this.installs[replacePkgUrl] = this.installs[pkgUrl];
        delete this.installs[pkgUrl];
      }
    }
  }

  async installTarget (pkgName: string, target: InstallTarget, pkgScope: string, pjsonPersist: boolean, parentUrl = pkgScope): Promise<string> {
    this.newInstalls = true;

    if (pjsonPersist) {
      if (pkgScope === this.installBaseUrl && pkgScope.startsWith('file:')) {
        this.added.set(pkgName, target);
      }
      else {
        log('info', `Package ${pkgName} not declared in package.json dependencies${importedFrom(parentUrl)}.`);
      }
    }

    if (target instanceof URL) {
      log('install', `${pkgName} ${pkgScope} -> ${target.href}`);
      const pkgUrl = target.href + (target.href.endsWith('/') ? '' : '/');
      lock.setResolution(this.installs, pkgName, pkgScope, pkgUrl);
      return pkgUrl;
    }

    if (this.opts.freezeLock) {
      const existingInstall = this.getBestMatch(target);
      if (existingInstall) {
        log('install', `${pkgName} ${pkgScope} -> ${existingInstall.registry}:${existingInstall.name}@${existingInstall.version}`);
        const pkgUrl = pkgToUrl(existingInstall, this.cdnUrl);
        lock.setResolution(this.installs, pkgName, pkgScope, pkgUrl);
        return pkgUrl;
      }
    }

    const latest = await resolver.resolveLatestTarget(target, parentUrl);
    const installed = await this.getInstalledPackages(target);
    const restrictedToPkg = await this.tryUpgradePackagesTo(latest, installed);

    // cannot upgrade to latest -> stick with existing resolution (if compatible)
    if (restrictedToPkg && !this.opts.latest) {
      log('install', `${pkgName} ${pkgScope} -> ${restrictedToPkg.registry}:${restrictedToPkg.name}@${restrictedToPkg.version}`);
      const pkgUrl = pkgToUrl(restrictedToPkg, this.cdnUrl);
      lock.setResolution(this.installs, pkgName, pkgScope, pkgUrl);
      return pkgUrl;
    }

    log('install', `${pkgName} ${pkgScope} -> ${latest.registry}:${latest.name}@${latest.version}`);
    const pkgUrl = pkgToUrl(latest, this.cdnUrl);
    lock.setResolution(this.installs, pkgName, pkgScope, pkgUrl);
    return pkgUrl;
  }

  async install (pkgName: string, pkgUrl: string, parentUrl: string = this.installBaseUrl): Promise<string> {
    if (!this.installing)
      throwInternalError();
    const existingUrl = this.installs[pkgUrl]?.[pkgName];
    if (existingUrl)
      return existingUrl;

    const pcfg = await resolver.getPackageConfig(pkgUrl) || {};

    // package dependencies
    const installTarget = pcfg.dependencies?.[pkgName] || pcfg.peerDependencies?.[pkgName] || pcfg.optionalDependencies?.[pkgName] || pcfg.devDependencies?.[pkgName];
    if (installTarget) {
      const target = newPackageTarget(installTarget, pkgUrl, pkgName);
      return this.installTarget(pkgName, target, pkgUrl, false, parentUrl);
    }

    // node.js core
    if (builtinSet.has(pkgName)) {
      const target = this.stdlibTarget;
      const resolution = (await this.installTarget(pkgName, target, pkgUrl, false, parentUrl)).slice(0, -1) + '|nodelibs/' + pkgName;
      lock.setResolution(this.installs, pkgName, pkgUrl, resolution);
      return resolution;
    }

    // global install fallback
    const target = newPackageTarget('*', pkgUrl, pkgName);
    const exactInstall = await this.installTarget(pkgName, target, pkgUrl, true, parentUrl);
    return exactInstall;
  }

  private async getInstalledPackages (pkg: InstallTarget): Promise<PackageInstallRange[]> {
    // TODO: to finish up version deduping algorithm, we need this
    // operation to search for all existing installs in this.installs
    // that have a target matching the given package
    // This is done by checking their package.json and seeing if the package.json target range
    // contains this target range
    return [];
  }

  private getBestMatch (pkg: PackageTarget): ExactPackage | null {
    let bestMatch: ExactPackage | null = null;
    for (const pkgUrl of Object.keys(this.installs)) {
      const { pkg } = parseCdnPkg(pkgUrl, cdnUrls) || {};
      if (pkg) {
        if (!bestMatch)
          bestMatch = pkg;
      }
    }
    return bestMatch;
  }

  // upgrade any existing packages to this package if possible
  private tryUpgradePackagesTo (pkg: ExactPackage, installed: PackageInstallRange[]): ExactPackage | undefined {
    if (this.opts.freezeLock) return;
    const pkgVersion = new Semver(pkg.version);
    let hasUpgrade = false;
    for (const version of new Set(installed.map(({ pkg }) => pkg.version))) {
      let hasVersionUpgrade = true;
      for (const { pkg, target } of installed) {
        if (pkg.version !== version) continue;
        // user out-of-version lock
        if (!this.opts.force && !target.ranges.some(range => range.has(pkg.version, true))) {
          hasVersionUpgrade = false;
          continue;
        }
        if (pkgVersion.lt(pkg.version) || !target.ranges.some(range => range.has(pkgVersion, true))) {
          hasVersionUpgrade = false;
          continue;
        }
      }
      if (hasVersionUpgrade) hasUpgrade = true;
      if (hasUpgrade || this.opts.latest) {
        for (const { pkg, install } of installed) {
          if (pkg.version !== version) continue;
          lock.setResolution(this.installs, install.name, install.pkgUrl, pkgToUrl(pkg, this.cdnUrl));
        }
      }
    }
  }
}
