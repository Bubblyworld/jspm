import sver from 'sver';
const { Semver } = sver;
import { log } from '../common/log.ts';
import { builtinModules } from 'module';
import { fileURLToPath } from 'url';
import * as lock from "./lock.ts";
import resolver from "./resolver.ts";
import { ExactPackage, newPackageTarget, PackageTarget, pkgToUrl } from "./package.ts";
import { isURL, importedFrom } from "../common/url.ts";
import { throwInternalError } from "../common/err.ts";

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
  // whether existing resolutions should be locked
  lock?: boolean;
  // force use latest versions for everything
  update?: boolean;

  // if a resolution is not in its expected range
  // / expected URL (usually due to manual user edits),
  // force override a new install
  // when clean: true is set, applies clean to unknowns too
  force?: boolean;
  // stdlib target
  stdlib?: string;

  cdnUrl?: string;
  lockfile?: boolean | 'read';
};

export class Installer {
  opts: InstallOptions;
  installs: lock.LockResolutions;
  installing = false;
  newInstalls = false;
  currentInstall = Promise.resolve();
  stdlibTarget: InstallTarget = new URL('../../../core/dist', import.meta.url);
  installBaseUrl: string;
  lockfilePath: string;
  cdnUrl = 'https://ga.jspm.io/';

  constructor (baseUrl: URL, opts: InstallOptions) {
    this.installBaseUrl = baseUrl.href;
    this.opts = opts;
    if (opts.cdnUrl)
      this.cdnUrl = opts.cdnUrl;
    this.lockfilePath = fileURLToPath(this.installBaseUrl + 'jspm.lock');
    const { resolutions } = this.opts.lockfile === false ? { resolutions: {} } : lock.loadVersionLock(this.lockfilePath);
    this.installs = resolutions;

    if (opts.stdlib) {
      if (isURL(opts.stdlib) || opts.stdlib[0] === '.') {
        this.stdlibTarget = new URL(opts.stdlib, baseUrl);
        if (this.stdlibTarget.href.endsWith('/'))
          this.stdlibTarget.pathname = this.stdlibTarget.pathname.slice(0, -1);
      }
      else {
        this.stdlibTarget = newPackageTarget(opts.stdlib);
      }
    }
  }

  async startInstall (): Promise<(success: boolean) => boolean> {
    if (this.installing)
      return this.currentInstall.then(() => this.startInstall());
    let finishInstall: (success: boolean) => boolean;
    this.installing = true;
    this.newInstalls = false;
    this.currentInstall = new Promise(resolve => {
      finishInstall = (success: boolean) => {
        const changed = success && (this.opts.lockfile === false || this.opts.lockfile === 'read' || lock.saveVersionLock(this.installs, this.lockfilePath));
        this.installing = false;
        resolve();
        return changed;
      };
    });
    return finishInstall!;
  }

  async lockInstall (installs: string[], pkgUrl = this.installBaseUrl, prune = true): Promise<[string, string][]> {
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
    const pruneList: [string, string][] = [...visited].map(item => {
      const [name, pkgUrl] = item.split('##');
      return [name, pkgUrl];
    });
    this.installs = lock.pruneResolutions(this.installs, pruneList);
    return pruneList;
  }

  async installTarget (pkgName: string, target: InstallTarget, pkgScope: string, parentUrl = pkgScope): Promise<string> {
    this.newInstalls = true;
    if (target instanceof URL) {
      log('install', `${pkgName} ${pkgScope} -> ${target.href}`);
      const pkgUrl = target.href + (target.href.endsWith('/') ? '' : '/');
      lock.setResolution(this.installs, pkgName, pkgScope, pkgUrl);
      return pkgUrl;
    }

    if (this.opts.lock) {
      const existingInstall = await this.getBestMatch(target);
      if (existingInstall) {
        log('install', `${pkgName} ${pkgScope} -> ${existingInstall.registry}:${existingInstall.name}@${existingInstall.version}`);
        const pkgUrl = pkgToUrl(existingInstall, this.cdnUrl);
        lock.setResolution(this.installs, pkgName, pkgScope, pkgUrl);
        return pkgUrl;
      }
    }

    const latest = await resolver.resolveLatestTarget(target, parentUrl);
    const installed = await this.getInstalledPackages(target.registry, target.name);
    const restrictedToPkg = await this.tryUpgradePackagesTo(latest, installed);

    // cannot upgrade to latest -> stick with existing resolution
    if (restrictedToPkg && !this.opts.update) {
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
      const target = newPackageTarget(installTarget, pkgName);
      return this.installTarget(pkgName, target, pkgUrl, parentUrl);
    }

    // node.js core
    if (builtinSet.has(pkgName)) {
      const target = this.stdlibTarget;
      const resolution = (await this.installTarget(pkgName, target, pkgUrl, parentUrl)).slice(0, -1) + '|nodelibs/' + pkgName;
      lock.setResolution(this.installs, pkgName, pkgUrl, resolution);
      return resolution;
    }

    // global install fallback
    log('info', `Package ${pkgName} not declared in package.json dependencies${importedFrom(parentUrl)}.`);
    const target = newPackageTarget('*', pkgName);
    const exactInstall = await this.installTarget(pkgName, target, pkgUrl, parentUrl);
    if (pkgUrl === this.installBaseUrl && pkgUrl.startsWith('file:')) {
      // add to package.json!
      // pjson.parseStyled(pjsonSource, pkgUrl);
      // (follows this.opts.save | this.opts.saveDev | this.opts.savePeer | this.opts.saveOptional)
      // console.log('TODO: local package.json installs');
    }
    return exactInstall;
  }

  private async getInstalledPackages (_registry: string, _name: string): Promise<PackageInstallRange[]> {
    // TODO: to finish up version deduping algorithm, we need this
    // operation to search for all existing installs in this.installs
    // that have a target matching the given package
    // This is done by checking their package.json and seeing if the package.json target range
    // contains this target range
    return [];
  }

  private async getBestMatch (pkg: PackageTarget): Promise<ExactPackage | undefined> {
    const existing = await this.getInstalledPackages(pkg.registry, pkg.name);
    let bestMatch: ExactPackage | undefined;
    for (const { pkg, target, install } of existing) {
      if (!bestMatch) {
        bestMatch = pkg;
      }
    }
    return bestMatch;
  }

  // upgrade any existing packages to this package if possible
  private tryUpgradePackagesTo (pkg: ExactPackage, installed: PackageInstallRange[]): ExactPackage | undefined {
    if (this.opts.lock) return;
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
      if (hasUpgrade || this.opts.update) {
        for (const { pkg, install } of installed) {
          if (pkg.version !== version) continue;
          lock.setResolution(this.installs, install.name, install.pkgUrl, pkgToUrl(pkg, this.cdnUrl));
        }
      }
    }
  }
}
