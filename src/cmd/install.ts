import TraceMap, { TraceMapOptions } from '../tracemap/tracemap.ts';
import { baseUrl } from '../common/url.ts';
import { pkgUrlToNiceString, toPackageTarget } from "../install/package.ts";
import { JspmError } from "../common/err.ts";
import process from 'process';
import { pathToFileURL } from 'url';

export async function install (targets: string | string[], opts: TraceMapOptions): Promise<{ changed: boolean, installed: string[] }> {
  if (typeof targets === 'string')
    targets = [targets];
  if (targets.length === 0)
    opts = { ...opts, fullInstall: true };
  opts = { ...opts, lock: true };
  const traceMap = new TraceMap(baseUrl, opts);

  const finishInstall = await traceMap.startInstall();
  try {
    const installed = await Promise.all(targets.map(async targetStr => {
      const { alias, target, subpath } = await toPackageTarget(targetStr, pathToFileURL(process.cwd() + '/').href);
      if (subpath !== '.')
        throw new JspmError(`Adding a dependency subpath '${subpath}' of package ${target instanceof URL ? target.href : target.name} is not supported.\nTry adding dependency '${targetStr.slice(0, targetStr.length - subpath.length + 1)}' instead.`);
      return pkgUrlToNiceString(await traceMap.add(alias, target));
    }));
    const changed  = await finishInstall(true);
    return { changed, installed };
  }
  catch (e) {
    await finishInstall(false);
    throw e;
  }
}
