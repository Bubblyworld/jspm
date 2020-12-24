import { baseUrl } from '../common/url.ts';
import { updatePjson } from "../tracemap/pjson.ts";

export async function rem (names: string | string[]): Promise<boolean> {
  if (typeof names === 'string')
    names = [names];

  return updatePjson(baseUrl, pjson => {
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
}
