import TraceMap, { TraceMapOptions } from '../tracemap/tracemap.ts';
import { baseUrl } from '../common/url.ts';
import { ImportMap } from "../tracemap/map.ts";
import { isPackageTarget, toPackageTarget } from "../install/package.ts";
import { pathToFileURL } from 'url';
import process from 'process';

export interface MapOptions extends TraceMapOptions {
  system?: boolean;
}

export async function map (modules: string | string[], opts: MapOptions): Promise<{
  changed: boolean,
  importMap: ImportMap
}> {
  if (typeof modules === 'string')
    modules = [modules];

  opts = { ...opts, save: opts.lock && !opts.freeze };

  const traceMap = new TraceMap(baseUrl, opts);

  const finishInstall = await traceMap.startInstall();
  try {
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
    var changed = await finishInstall(true);
    const map = traceMap.map;
    map.flatten();
    map.rebase();
    map.sort();
    if (opts.system)
      map.replace('https://ga.jspm.io/', new URL('https://ga.system.jspm.io/'));
    return { changed, importMap: map };
  }
  catch (e) {
    finishInstall(false);
    throw e;
  }
}
