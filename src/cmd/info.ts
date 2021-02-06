import resolver from "../install/resolver.ts";
import { pathToFileURL, fileURLToPath } from 'url';
import { existsSync } from 'fs';
import process from 'process';

export async function info (path: string = process.cwd() + '/') {
  const parentPkgUrl = await resolver.getPackageBase(pathToFileURL(path).href);
  const parentPkgPath = fileURLToPath(parentPkgUrl);
  const pjson = parentPkgPath + 'package.json';
  const lock = parentPkgPath + 'jspm.lock';
  return {
    projectPath: parentPkgPath,
    packageJSON: existsSync(pjson) ? true : false,
    lockFile: existsSync(lock) ? true : false
  };
}