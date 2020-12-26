import { createHash } from 'crypto';
import TraceMap, { TraceMapOptions } from '../tracemap/tracemap.ts';
import { baseUrl } from '../common/url.ts';
import os from 'os';
import { computeIntegrity } from "../common/integrity.ts";
import { readFileSync, writeFileSync } from 'fs';
import { runCmd } from '../common/cmd.ts';
import { isPackageTarget, toPackageTarget } from "../install/package.ts";
import process from 'process';

function computeMapHash (path: string) {
  const mapPrefix = createHash('sha256').update(path).digest().toString('base64').replace(/\//g, '-').slice(0, 8);
  const mapSuffix = createHash('sha256').update(readFileSync(path + '/package.json')).update(readFileSync(path + '/jspm.lock')).digest().toString('base64').replace(/\//g, '-').slice(0, 16);
  return { mapPrefix, mapSuffix };
}

export async function deno (targetStr: string, flags: string[] = [], args: string[] = [], opts: TraceMapOptions = {}): Promise<number> {
  opts = Object.assign({}, opts);
  opts.env = opts.env || [];
  if (!opts.env.includes('deno'))
    opts.env.push('deno');
  if (!opts.env.includes('browser'))
    opts.env.push('browser');
  if (!opts.env.includes('node'))
    opts.env.push('node');

  const tmpDir = '/tmp'; // os.tmpdir();
  let mapFile: string | undefined;

  if (!opts.install) {
    const { mapPrefix, mapSuffix } = computeMapHash(process.cwd());
    try {
      const existingMap = readFileSync(tmpDir + '/' + mapPrefix + '-' + mapSuffix + '.importmap').toString();
      // JSON.parse(existingMap);
      mapFile = tmpDir + '/' + mapPrefix + '-' + mapSuffix + '.importmap';
    }
    catch {}
    if (mapFile)
      return await runCmd(`deno run --unstable --no-check --importmap ${mapFile} ${flags.join(' ')} ${targetStr} ${args.join(' ')}`);
  }

  const traceMap = new TraceMap(baseUrl, opts);
  const finishInstall = await traceMap.startInstall();
  try {
    let module: string;
    if (isPackageTarget(targetStr)) {
      const { alias, target, subpath } = await toPackageTarget(targetStr);
      await traceMap.add(alias, target);
      module = alias + subpath.slice(1);
    }
    else {
      module = new URL(targetStr, baseUrl).href;
    }
    var resolved = await traceMap.trace(module);
    await finishInstall(true);
  }
  catch (e) {
    finishInstall(false);
    throw e;
  }
  const map = traceMap.map.toString();
  const { mapPrefix, mapSuffix } = computeMapHash(process.cwd());
  mapFile = tmpDir + '/' + mapPrefix + '-' + mapSuffix + '.importmap';
  writeFileSync(mapFile, map);
  const code = await runCmd(`deno run --unstable --no-check --importmap ${mapFile} ${flags.join(' ')} ${resolved} ${args.join(' ')}`);
  return code;
}