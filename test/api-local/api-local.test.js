import TraceMap from 'jspm/tracemap';
import assert from 'assert';

// Use jspm base -> it's actually important to have a package.json in the base URL
//                  (this could likely be improved)
const base = new URL('../../', import.meta.url);

const traceMap = new TraceMap(base, {
  stdlib: '@jspm/core@2',
  lock: false,
  env: ['browser', 'development']
});

const finishInstall = await traceMap.startInstall();
try {
  // Install the local package as "localpkg"
  // This "installs" to "base" above, which was why it needed a package.json
  await traceMap.add('localpkg', new URL('./localpkg', import.meta.url));

  // Trace the package
  await traceMap.trace('localpkg');

  await finishInstall(true);
  const map = traceMap.map;
  // deduplicates scopes
  map.flatten();
  // rebases the map to the base url
  map.rebase();
  // sorts map alphabetically
  map.sort();

  const json = map.toJSON();
  assert.strictEqual(json.imports.localpkg, './test/api-local/localpkg/main.js');

  // Note - react version installed from package.json range in test/api-local/localpkg/package.json
  assert.strictEqual(json.scopes['./test/api-local/localpkg/'].react, 'https://ga.jspm.io/npm:react@16.14.0/dev.index.js');
}
catch (err) {
  finishInstall(false);
  throw err;
}
