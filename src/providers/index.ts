import * as nest from './nest.land.js';
// import * as deno from './deno.land.ts';
import * as jspm from './jspm.io.js';
import { PackageConfig, ExactPackage } from '../install/package.js';
import { Resolver } from '../install/resolver.js';
import { PackageTarget } from '../install/package.js';

interface Provider {
  cdnUrl: string;
  parseUrlPkg (this: Resolver, url: string): ExactPackage | undefined;
  pkgToUrl (this: Resolver, pkg: ExactPackage): string;
  getPackageConfig? (this: Resolver, pkgUrl: string): Promise<PackageConfig | null | undefined>;
  resolveLatestTarget (this: Resolver, target: PackageTarget, unstable: boolean, parentUrl?: string): Promise<ExactPackage | null>;
  getFileList? (this: Resolver, pkgUrl: string): Promise<string[]>;
}

export const providers: Record<string, Provider> = {
  [nest.cdnUrl]: nest,
  // [deno.cdnUrl]: deno,
  [jspm.cdnUrl]: jspm
};

export const registryProviders: Record<string, Provider> = {
  nest: nest,
  // deno: deno,
  npm: jspm
};
