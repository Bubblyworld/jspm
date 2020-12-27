import { baseUrl } from '../common/url.ts';
import { updatePjson } from "../tracemap/pjson.ts";
import TraceMap from '../tracemap/tracemap.ts';

export async function rem (names: string | string[]): Promise<boolean> {
  if (typeof names === 'string')
    names = [names];

  const changed = await updatePjson(baseUrl, pjson => {
    for (const name of names) {
      if (pjson.dependencies?.[name])
        delete pjson.dependencies[name];
      if (pjson.devDependencies?.[name])
        delete pjson.devDependencies[name];
      if (pjson.optionalDependencies?.[name])
        delete pjson.optionalDependencies[name];
      if (pjson.peerDependencies?.[name])
        delete pjson.peerDependencies[name];
    }
  });

  if (changed) {
    const traceMap = new TraceMap(baseUrl, { fullInstall: true });

    const finishInstall = await traceMap.startInstall();
    try {
      await finishInstall(true);
      return changed;
    }
    catch (e) {
      await finishInstall(false);
      throw e;
    }
  }

  return changed;
}
