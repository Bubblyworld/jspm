import * as nest from './nest.land.ts';
// import * as deno from './deno.land.ts';
import * as jspm from './jspm.io.ts';
import { PackageConfig, ExactPackage } from '../install/package.ts';
import { Resolver } from '../install/resolver.ts';
import { PackageTarget } from '../install/package.ts';

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
