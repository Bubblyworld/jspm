import { JspmError } from "../common/err.js";
import { importedFrom } from "../common/url.js";
import { ExactPackage, PackageTarget } from "../install/package.js";
import { Resolver } from "../install/resolver.js";

export const cdnUrl = 'https://x.nest.land/';

export function pkgToUrl (pkg: ExactPackage) {
  return cdnUrl + pkg.name + '/' + pkg.version + '/';
}

export function parseUrlPkg (url: string): ExactPackage | undefined {
  if (!url.startsWith(cdnUrl))
    return;
  const [name, version] = url.slice(cdnUrl.length).split('/');
  return { registry: 'nest', name, version };
}

export async function resolveLatestTarget (this: Resolver, target: PackageTarget, unstable: boolean, parentUrl?: string): Promise<ExactPackage | null> {
  if (target.registry !== 'nest')
    return null;
  const res = await fetch('https://x.nest.land/api/package/' + target.name, this.fetchOpts);
  switch (res.status) {
    case 304:
    case 200:
      const egg = await res.json();
      const versions = egg.packageUploadNames.map((name: string) => name.slice(name.indexOf('@') + 1));
      let bestMatch;
      for (const range of target.ranges) {
        const match = range.bestMatch(versions, unstable);
        if (match && (!bestMatch || match.gt(bestMatch)))
          bestMatch = match;
      }
      if (!bestMatch)
        return null;
      return { registry: 'nest', name: egg.normalizedName, version: bestMatch.toString() };
    case 404:
      return null;
    default:
      throw new JspmError(`Invalid status code ${res.status} looking up "${target.registry}:${target.name}" - ${res.statusText}${importedFrom(parentUrl)}`);
  }
}
