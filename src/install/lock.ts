import toml from '@iarna/toml';
// @ts-ignore
import { readFileSync, writeFileSync } from 'fs';
import { throwInternalError, JspmError } from '../common/err.js';
// @ts-ignore
import { pathToFileURL } from 'url';
import { relativeUrl } from "../common/url.js";

export interface Lockfile {
  exists: boolean;
  resolutions: LockResolutions;
}

export interface LockResolutions {
  [pkgUrl: string]: Record<string, string>;
}

export function getResolution (resolutions: LockResolutions, name: string, pkgUrl: string): string | undefined {
  if (!pkgUrl.endsWith('/'))
    throwInternalError();
  resolutions[pkgUrl] = resolutions[pkgUrl] || {};
  return resolutions[pkgUrl][name];
}

export function setResolution (resolutions: LockResolutions, name: string, pkgUrl: string, resolution: string) {
  if (!pkgUrl.endsWith('/'))
    throwInternalError();
  resolutions[pkgUrl] = resolutions[pkgUrl] || {};
  resolutions[pkgUrl][name] = resolution;
}

export function pruneResolutions (resolutions: LockResolutions, to: [string, string][]): LockResolutions {
  const newResolutions: LockResolutions = {};
  for (const [name, parent] of to) {
    const resolution = resolutions[parent][name];
    newResolutions[parent] = newResolutions[parent] || {};
    newResolutions[parent][name] = resolution;
  }
  return newResolutions;
}

export function loadVersionLock (lockFile: string): Lockfile {
  let exists = false;
  const resolutions: LockResolutions = {};

  const lockUrl = pathToFileURL(lockFile);

  function parseResolutionURL (url: string, name?: string) {
    try {
      return new URL(url + (url[url.length - 1] === '/' || url.indexOf('|') !== -1 ? '' : '/'), lockUrl).href;
    }
    catch {
      throw new JspmError(`Invalid package URL ${url} ${name ? `for ${name} ` : ''}in lockfile ${lockFile}`, 'ERR_INVALID_LOCKFILE');
    }
  }

  function parseResolutions (deps: Record<string, string>, resolutions: Record<string, Record<string, string>>): Record<string, string> {
    const pkgResolutions: Record<string, string> = Object.create(null);
    for (const impt of Object.keys(deps)) {
      const resolution = deps[impt];
      if (typeof resolution !== 'string')
        continue;
      const url = parseResolutionURL(resolution, impt);
      resolutions[url] = resolutions[url] || Object.create(null);
      pkgResolutions[impt] = url;
    }
    return pkgResolutions;
  }

  let source;
  try {
    source = readFileSync(lockFile);
    exists = true;
  }
  catch {}

  const { package: packages } = source ? toml.parse(source.toString()) : { package: null };

  if (!Array.isArray(packages))
    return { resolutions, exists };

  for (const { url, deps } of packages) {
    const scopeURL = parseResolutionURL(url);
    if (typeof deps === 'object')
      resolutions[scopeURL] = parseResolutions(deps, resolutions);
    else if (scopeURL.endsWith('/'))
      resolutions[scopeURL] = Object.create(null);
  }

  return { resolutions, exists };
}

export function saveVersionLock (resolutions: LockResolutions, lockFile: string) {
  const lockFileUrl = new URL('./', pathToFileURL(lockFile));
  const packages: { url: string, deps?: Record<string, string> }[] = [];
  for (const pkgUrl of Object.keys(resolutions)) {
    const url = relativeUrl(new URL(pkgUrl), lockFileUrl).slice(0, -1);
    const entries: [string, string][] = Object.entries(resolutions[pkgUrl]);
    if (entries.length === 0)
      continue;
    packages.push(entries.length ? {
      url,
      deps: Object.fromEntries(entries.map(([key, value]) => {
        const target = relativeUrl(new URL(value), lockFileUrl);
        return [key, target.endsWith('/') ? target.slice(0, -1) : target];
      }).sort(([a], [b]) => a.localeCompare(b)))
    } : { url });
  }
  packages.sort(({ url: a }, { url: b }) => a.localeCompare(b));
  let original;
  try {
    original = readFileSync(lockFile).toString();
  } catch {}
  const output = '# Generated by jspm\n' + toml.stringify({ package: packages }).split('\n').map((line: string) => line.trimLeft()).join('\n');
  if (output !== original) {
    writeFileSync(lockFile, output);
    return true;
  }
  return false;
}
