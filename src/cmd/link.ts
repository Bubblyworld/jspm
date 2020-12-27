import TraceMap, { TraceMapOptions } from '../tracemap/tracemap.ts';
import { baseUrl } from '../common/url.ts';
import { ImportMap } from "../tracemap/map.ts";
import { isPackageTarget, toPackageTarget } from "../install/package.ts";
import { pathToFileURL } from 'url';
import process from 'process';

export async function link (modules: string | string[], opts: TraceMapOptions): Promise<{
  changed: boolean,
  map: ImportMap
}> {
  if (typeof modules === 'string')
    modules = [modules];

  opts = { ...opts, install: true };

  const traceMap = new TraceMap(baseUrl, opts);

  const finishInstall = await traceMap.startInstall();
  try {
    if (modules.length) {
      await Promise.all(modules.map(async targetStr => {
        let module;
        if (isPackageTarget(targetStr)) {
          const { alias, target, subpath } = await toPackageTarget(targetStr, pathToFileURL(process.cwd() + '/').href);
          await traceMap.add(alias, target);
          module = alias + subpath.slice(1);
        }
        else {
          module = new URL(targetStr, baseUrl).href;
        }
        return traceMap.trace(module);
      }));
    }
    else {
      opts.fullMap = true;
      opts.fullInstall = true;
    }
    var changed = await finishInstall(true);
    const map = traceMap.map;
    map.flatten();
    map.rebase();
    map.sort();
    return { changed, map };
  }
  catch (e) {
    finishInstall(false);
    throw e;
  }
}
