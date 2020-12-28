import TraceMap from '../tracemap/tracemap.ts';
import { baseUrl } from '../common/url.ts';
import { toPackageTarget } from "../install/package.ts";
import { pathToFileURL } from 'url';
import process from 'process';
import { JspmError } from '../common/err.ts';
import resolver from '../install/resolver.ts';
import { fileURLToPath } from 'url';

export async function checkout (targetStr: string, depsDir: string = 'deps', beautify = false): Promise<string | null> {
  const traceMap = new TraceMap(baseUrl, { install: true, save: true });

  const finishInstall = await traceMap.startInstall();
  try {
    const { alias, target, subpath } = await toPackageTarget(targetStr, pathToFileURL(process.cwd() + '/').href);
    const pkgUrl = await traceMap.add(alias, target, false);
    if (subpath !== '.')
      throw new JspmError(`Cannot checkout a subpath of a package.`);

    const checkoutUrl = new URL(depsDir + '/' + alias + '/', baseUrl);

    await resolver.dlPackage(pkgUrl, fileURLToPath(checkoutUrl));
    const replaced = traceMap.replace(target, checkoutUrl.href);

    if (!replaced)
      return null;

    const didCheckOut = await finishInstall(true);
    if (didCheckOut)
      return checkoutUrl.href;

    return null;
  }
  catch (e) {
    finishInstall(false);
    throw e;
  }
}
