import TraceMap from 'jspm/tracemap';
import { SemverRange } from 'sver';
import { pathToFileURL } from 'url';
import assert from 'assert';

const base = new URL('/', pathToFileURL(process.cwd()));

const traceMap = new TraceMap(base, {
  stdlib: '@jspm/core@2',
  lock: false,
  env: ['browser', 'development']
});

const finishInstall = await traceMap.startInstall();
try {
  // Install "react" to "npm:react^@0.17"
  // This populates the "lockfile"
  await traceMap.add('react', { registry: 'npm', name: 'react', ranges: [new SemverRange('^16')] });

  // Trace "react". Tracing is what populates the map - we only output in the map what is actually _used_ = traced.
  await traceMap.trace('react');

  await finishInstall(true);
  const map = traceMap.map;
  map.flatten();
  map.rebase();
  map.sort();

  const json = map.toJSON();
  assert.strictEqual(json.imports.react, 'https://ga.jspm.io/npm:react@16.14.0/dev.index.js');
}
catch (err) {
  finishInstall(false);
  throw err;
}
