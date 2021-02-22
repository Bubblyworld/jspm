import TraceMap, { TraceMapOptions } from '../tracemap/tracemap.ts';
import { baseUrl } from '../common/url.ts';
import { isPackageTarget, toPackageTarget } from "../install/package.ts";
import { pathToFileURL } from 'url';
import process from 'process';
import { readFileSync } from 'fs';
import { Script } from "../inject/map";
import { pathToFileURL } from 'url';

export interface MapOptions extends TraceMapOptions {
  out?: string;
  minify?: boolean;
  integrity?: boolean;
  preload?: boolean;
}

export async function map (modules: string | string[], opts: MapOptions): Promise<{
  changed: boolean,
  output: string
}> {
  if (typeof modules === 'string')
    modules = [modules];

  opts = { ...opts, save: opts.lock && !opts.freeze };

  if (typeof opts.inputMap === 'string')
    opts.inputMap = JSON.parse(readFileSync(opts.inputMap).toString());

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

    let systemBabel = false;
    const { system, esm } = traceMap.checkTypes();
    if (system || opts.system) {
      opts.system = true;
      systemBabel = esm;
    }

    let preloads: Script[] | undefined;
    if (opts.preload || opts.integrity)
      preloads = traceMap.getPreloads(!!opts.integrity, baseUrl);

    if (opts.system)
      map.replace('https://ga.jspm.io/', new URL('https://ga.system.jspm.io/'));

    let output: string;
    if (!opts.out || !opts.out.endsWith('.html')) {
      output = map.toString(opts.minify);
    }
    else {
      const html = readFileSync(opts.out).toString();
      const { inject } = await import('../inject/map.ts');
      const system = opts.system ? { url: '/system.js' } : null;
      output = inject(html, {
        importMap: map.toJSON(),
        preloads,
        system,
        systemBabel: systemBabel ? { url: '/system-babel.js' } : null
      });
    }

    return { changed, output };
  }
  catch (e) {
    finishInstall(false);
    throw e;
  }
}
