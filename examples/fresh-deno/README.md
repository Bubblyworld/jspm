# Deno & Fresh
Using the CLI, it's possible to quickly and painlessly spin up a Deno web
application in the Fresh framework with minimal setup.

First a directory should be created for initialization with any preferable name:

```sh
mkdir fresh-deno
cd fresh-deno
```
## Initialization

And then with the CLI, a new import map gets created to be the main importmap
for our Deno application. As an initial dependency, the application needs the `fresh/server.ts` code to run the server.
```
jspm install denoland:fresh/server.ts --env=deno
```
This command will add
[`fresh/server.ts`](https://deno.land/x/fresh@1.1.2/server.ts) to the importmap,
and the `--env=deno` enforces the `deno` environment to the importmap, so the
CLI is going to remember this environment for future operations and commands.

## Entry

Since the application has the fresh server dependency, it is possible to create
the application's server code in an entry file called `main.ts`:

```ts
import { start } from 'fresh/server.ts'
import * as $0 from './routes/index.tsx'

const manifest = {
  routes: {
    './routes/index.tsx': $0,
  },
  islands: {},
  baseUrl: import.meta.url,
}

await start(manifest)
```

It is possible to skip the `islands` config and only focus on a minimal Fresh
application setup with a `/` route. 

## Routes

In this case, a simple `/` route should be created with any
content as a `./routes/index.tsx` file, for instance:

```tsx
import { Head } from 'fresh/runtime.ts'

export default function Home() {
  return (
    <>
      <Head>
        <title>Fresh App Using JSPM</title>
      </Head>
      <div>
        <p>
          This is a Fresh app built using JSPM.
        </p>
      </div>
    </>
  )
}
```
This file needs two new dependencies, `fresh/runtime.ts` for the `Head`
component and `preact/jsx-runtime` for the JSX support.
```
jspm install denoland:fresh/runtime.ts preact/jsx-runtime
```
which would result in such an importmap:
```json
{
  "env": [
    "deno",
    "development",
    "module"
  ],
  "imports": {
    "fresh/runtime.ts": "https://deno.land/x/fresh@1.1.2/runtime.ts",
    "fresh/server.ts": "https://deno.land/x/fresh@1.1.2/server.ts",
    "preact": "https://ga.jspm.io/npm:preact@10.11.3/dist/preact.mjs",
    "preact/jsx-runtime": "https://ga.jspm.io/npm:preact@10.11.3/jsx-runtime/dist/jsxRuntime.mjs"
  },
  "scopes": {
    "https://deno.land/": {
      "preact-render-to-string": "https://ga.jspm.io/npm:preact-render-to-string@5.2.6/dist/index.mjs",
      "preact/hooks": "https://ga.jspm.io/npm:preact@10.11.3/hooks/dist/hooks.mjs"
    }
  }
}
```

Now the application needs a `deno.json` file to run the entry file, which can
something like:
```json
{
  "tasks": {
    "start": "deno run -A main.ts"
  },
  "importMap": "./importmap.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "preact"
  }
}
```
The `importMap` is a critical key and it should be specified, otherwise the application would not
work at all.

## Running
Using `deno task` the application is runnable.
```sh
deno task start
```

And a user can navigate to the `http://localhost:8000` link.

## Node packages
JSPM is able to bring most of the Nodejs packages to environments like the Browser
and Deno.
One of the most popular packages in npm for nodejs is `qs` which is a
light-weight querystring parser. JSPM can install this package in deno easily
using:
```sh
jspm install qs
```




