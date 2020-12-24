import * as json from "../common/json.ts";
import { readFileSync, writeFileSync } from "fs";
import resolver from "../install/resolver.ts";
import { PackageConfig } from "../install/package.ts";

export type DependenciesField = 'dependencies' | 'devDependencies' | 'peerDependencies' | 'optionalDependencies';

type ExportsTarget = string | null | { [condition: string]: ExportsTarget } | ExportsTarget[];

export interface PackageJson {
  registry?: string;
  name?: string;
  version?: string;
  main?: string;
  files?: string[];
  browser?: string | Record<string, string>;
  exports?: ExportsTarget | Record<string, ExportsTarget>;
  type?: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export async function updatePjson (pjsonBase: URL, updateFn: (pjson: PackageJson) => void | PackageJson | Promise<void | PackageJson>): Promise<boolean> {
  const pjsonUrl = new URL('package.json', pjsonBase);
  const input = readFileSync(pjsonUrl).toString();
  let { json: pjson, style } = json.parseStyled(input);
  pjson = await updateFn(pjson) || pjson;
  const output = json.stringifyStyled(pjson, style);
  if (output === input)
    return false;
  writeFileSync(pjsonUrl, json.stringifyStyled(pjson, style));
  resolver.pcfgs[pjsonBase.href] = pjson as PackageConfig;
  return true;
}
