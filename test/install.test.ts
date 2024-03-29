import fs from 'fs/promises'
import assert from 'assert'
import install from '../src/install'

{
  /* basic install */
  const map = await install(['react@17.0.1', 'react-dom@17.0.1'], {
    env: 'development',
    stdout: true,
    map: 'test/importmap.json',
  })
  assert.strictEqual(
    map.imports.react,
    'https://ga.jspm.io/npm:react@17.0.1/dev.index.js',
  )
}

{
  /* env */
  const map = await install(['react@17.0.1', 'react-dom@17.0.1'], {
    env: 'production,browser',
    stdout: true,
    map: 'test/importmap.json',
  })
  assert.strictEqual(
    map.imports.react,
    'https://ga.jspm.io/npm:react@17.0.1/index.js',
  )
}

{
  /* env with adding deno should negate browser */
  await install(['react@17.0.1', 'react-dom@17.0.1'], {
    env: 'deno',
    map: 'test/importmap.json',
  })

  let map = JSON.parse(
    await fs.readFile('test/importmap.json', 'utf-8'),
  )
  assert.deepEqual(
    map.env, ['deno', 'module', 'production'],
  )
  assert.strictEqual(
    map.imports.react,
    'https://ga.jspm.io/npm:react@17.0.1/index.js',
  )

  /* env with adding browser should negate browser */
  await install(['react@17.0.1', 'react-dom@17.0.1'], {
    env: 'deno,browser',
    map: 'test/importmap.json',
  })

  map = JSON.parse(
    await fs.readFile('test/importmap.json', 'utf-8'),
  )
  assert.deepEqual(
    map.env, ['browser', 'deno', 'module', 'production'],
  )
  assert.strictEqual(
    map.imports.react,
    'https://ga.jspm.io/npm:react@17.0.1/index.js',
  )
}

{
  /* alias */
  const map = await install(['custom=react@17.0.1'], {
    env: 'production',
    map: 'test/importmap.json',
    stdout: true,
  })
  assert.strictEqual(
    map.imports.custom,
    'https://ga.jspm.io/npm:react@17.0.1/index.js',
  )
}

{
  /* reinstall */
  const map = await install([], {
    env: 'no-deno,production',
    map: 'test/importmap.json',
    stdout: true,
  })
  assert.ok(!map.imports.react.endsWith('/dev.index.js'))
}

{
  await fs.copyFile('test/importmap.json', 'test/importmap.modified.json')
  /* basic install with env */
  await install(['react@17.0.1', 'react-dom@17.0.1'], {
    env: 'production,deno',
    map: 'test/importmap.modified.json',
  })
  const map = JSON.parse(
    await fs.readFile('test/importmap.modified.json', 'utf-8'),
  )
  assert.strictEqual(
    map.imports.react,
    'https://ga.jspm.io/npm:react@17.0.1/index.js',
  )
  assert.deepEqual(
    map.env, ['deno', 'module', 'production'],
  )
}

{
  /* basic install with loading env */
  await install(['react@17.0.1', 'react-dom@17.0.1'], {
    map: 'test/importmap.modified.json',
  })
  const map = JSON.parse(
    await fs.readFile('test/importmap.modified.json', 'utf-8'),
  )
  assert.deepEqual(
    map.env, ['deno', 'module', 'production'],
  )

  const keys = Object.keys(map)
  // `env` appears at the top
  assert.equal(keys[0], 'env')

  await fs.rm('test/importmap.modified.json')
}

{
  /* provider */
  const map = await install(['react@17.0.1', 'react-dom@17.0.1'], {
    env: 'production,browser',
    provider: 'jsdelivr',
    map: 'test/importmap.json',
    stdout: true,
  })
  assert.deepEqual(
    map.imports.react, 'https://cdn.jsdelivr.net/npm/react@17.0.1/index.js',
  )
}
