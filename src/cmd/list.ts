import resolver from '../install/resolver.js';
import { ExportsTarget, toPackageTarget, pkgUrlToNiceString } from '../install/package.js';
import { JspmError } from '../common/err.js';
// @ts-ignore
import { pathToFileURL } from 'url';
// @ts-ignore
import process from 'process';

export async function list (module: string): Promise<{
  resolved: string,
  exports: Record<string, ExportsTarget>
}> {
  const { target, subpath } = await toPackageTarget(module, pathToFileURL(process.cwd() + '/').href);

  let pkgUrl: string;
  if (!(target instanceof URL)) {
    const resolved = await resolver.resolveLatestTarget(target, false);
    pkgUrl = resolver.pkgToUrl(resolved);
  }
  else {
    pkgUrl = target.href;
  }

  const pcfg = await resolver.getPackageConfig(pkgUrl);
  if (!pcfg)
    throw new JspmError(`No package configuration found for ${pkgUrlToNiceString(pkgUrl)}.`);

  if (!pcfg.exports)
    throw new JspmError(`No package exports defined for package ${pkgUrlToNiceString(pkgUrl)}.`);

  let exports: Record<string, ExportsTarget> = typeof pcfg.exports === 'object' && !(pcfg.exports instanceof Array) && pcfg.exports !== null ? pcfg.exports : { '.': pcfg.exports };

  if (Object.keys(exports).every(key => key[0] !== '.'))
    exports = { '.': exports };

  const matches: string[] = Object.keys(exports).filter(key => key.startsWith(subpath) && !key.endsWith('!cjs'));
  if (!matches.length)
    throw new JspmError(`No exports matching ${subpath} in ${pkgUrlToNiceString(pkgUrl)}`);

  const filteredExports: Record<string, ExportsTarget> = {};
  for (const key of matches) {
    filteredExports[key] = exports[key];
  }

  return { resolved: pkgUrlToNiceString(pkgUrl.slice(0, -1)), exports: filteredExports };
}
