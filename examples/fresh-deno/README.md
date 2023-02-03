# Deno & Fresh
Using the CLI, it's possible to quickly and painlessly spin up a Deno web
application in the Fresh framework with minimal setup.
In this workflow tutorial, a small fresh deno server gets created using JSPM
powered importmaps and also running client code with the same importmap.

First a directory should be created for initialization with any preferable name:

```sh
mkdir fresh-deno
cd fresh-deno
```
## Initialization

And then with the CLI, a new import map gets created to be the main importmap
for our Deno application. As an initial dependency, the application needs the `fresh/server.ts` code to run the server.
```sh
$ jspm install denoland:fresh/server.ts --env=deno

Ok: Updated importmap.json
```
This command will add
[`fresh/server.ts`](https://deno.land/x/fresh@1.1.2/server.ts) to the importmap,
and the `--env=deno` enforces the `deno` environment to the importmap, so the
CLI is going to remember this environment for future operations and commands.

## Entry

Since the application has the fresh server dependency, it is possible to create
the application's server code in an entry file called `main.ts`.

`main.ts`:
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
content as a `./routes/index.tsx` file.

`./routes/index.tsx`:
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
$ jspm install denoland:fresh/runtime.ts preact/jsx-runtime

Ok: Updated importmap.json
```
which would result in such an importmap:

`importmap.json`:
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

Now the application needs a `deno.json` file to run the entry file.

`deno.json`:
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

```sh
$ deno task start

Import map diagnostics:
  - Invalid top-level key "env". Only "imports" and
 "scopes" can be present.
Task start deno run -A main.ts
Import map diagnostics:
  - Invalid top-level key "env". Only "imports" and
 "scopes" can be present.
Listening on http://localhost:8000/
```

Using this command, deno would start the server, and then a user can navigate to the `http://localhost:8000` link.

## Node packages
JSPM is able to bring most of the Nodejs packages to environments like the Browser
and Deno.
One of the most popular packages in npm for nodejs is `qs` which is a
light-weight querystring parser. JSPM can install this package in deno easily
using:
```sh
$ jspm install qs

Ok: Updated importmap.json
```
Then `qs` could parse the application requests.

`routes/index.ts`:
```diff
+ import qs from 'qs'
import { Head } from 'fresh/runtime.ts'

export default function Home(props) {
+  console.log(qs.parse(props.url.search.slice(1)))

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
In this case, the application will log `{ cli: "jspm" }` in the server on requests to `http://localhost:8000/?cli=jspm`

## Client code

By default this app has nothing to run on the client since it does not have any
islands. By injecting client code and browser compatible importmap in the `routes/index.tsx` route, the browser
would run javascript code with modules handled by the importmap.

First, a browser compatible importmap should be created using the initial
importmap.

```sh
$ jspm install --env=browser -o=importmap.browser.json

Ok: Updated importmap.json
```
This would create an importmap based on the default importmap (`importmap.json`)
and writes it into the `importmap.browser.json` file which is the output file.

`importmap.browser.json`:
```json
{
  "env": [
    "browser",
    "development",
    "module"
  ],
  "imports": {
    "fresh/runtime.ts": "https://deno.land/x/fresh@1.1.2/runtime.ts",
    "fresh/server.ts": "https://deno.land/x/fresh@1.1.2/server.ts",
    "preact": "https://ga.jspm.io/npm:preact@10.11.3/dist/preact.module.js",
    "preact/jsx-runtime": "https://ga.jspm.io/npm:preact@10.11.3/jsx-runtime/dist/jsxRuntime.module.js",
    "qs": "https://ga.jspm.io/npm:qs@6.11.0/lib/index.js"
  },
  "scopes": {
    "https://deno.land/": {
      "preact-render-to-string": "https://ga.jspm.io/npm:preact-render-to-string@5.2.6/dist/index.mjs",
      "preact/hooks": "https://ga.jspm.io/npm:preact@10.11.3/hooks/dist/hooks.module.js"
    },
    "https://ga.jspm.io/": {
      "#util.inspect.js": "https://ga.jspm.io/npm:object-inspect@1.12.3/util.inspect.js",
      "call-bind/callBound": "https://ga.jspm.io/npm:call-bind@1.0.2/callBound.js",
      "function-bind": "https://ga.jspm.io/npm:function-bind@1.1.1/index.js",
      "get-intrinsic": "https://ga.jspm.io/npm:get-intrinsic@1.2.0/index.js",
      "has": "https://ga.jspm.io/npm:has@1.0.3/src/index.js",
      "has-symbols": "https://ga.jspm.io/npm:has-symbols@1.0.3/index.js",
      "object-inspect": "https://ga.jspm.io/npm:object-inspect@1.12.3/index.js",
      "side-channel": "https://ga.jspm.io/npm:side-channel@1.0.4/index.js"
    },
    "https://ga.jspm.io/npm:object-inspect@1.12.3/": {
      "#util.inspect.js": "https://ga.jspm.io/npm:@jspm/core@2.0.0/nodelibs/@empty.js"
    }
  }
}
```

Since this importmap needs to be injected into the html response in fresh, the
`@jspm/generator` package should be installed that offers the injecting feature
for our deno server.

```sh
$ jspm install @jspm/generator

Ok: Updated importmap.json
```
This would install `@jspm/generator` in the importmap (`importmap.json`) where
the inject feature is going to be used.

Then the code of the injecting step should be added to the index route.
`routes/index.tsx`:
```diff
import qs from 'qs';
import { Handlers } from 'fresh/server.ts';
import { Head } from 'fresh/runtime.ts';
+ import { Generator } from '@jspm/generator';

+ const isProduction = Deno.env.get('ENV') === 'production';

+ const browserMap = await Deno.readTextFile('./importmap.browser.json');

+ const generator = new Generator({
+   inputMap: JSON.parse(browserMap),
+   mapUrl: import.meta.url,
+   env: [isProduction ? 'production' : 'development', 'browser', 'module'],
+ });

+ await generator.reinstall();

+ export const handler: Handlers = {
+   async GET(req, ctx) {
+     const response = await ctx.render();
+     const html = (await response.body?.getReader().read())?.value;
+     const htmlString = new TextDecoder().decode(html);
+     const injectedHtml = await generator.htmlInject(htmlString, {});
+     return new Response(injectedHtml, {
+       headers: { 'content-type': 'text/html' },
+     });
+   },
+ };

export default function Home(props) {
  console.log(qs.parse(props.url.search.slice(1)));

  return (
    <>
      <Head>
        <title>Fresh App Using JSPM</title>
+         <script type="module">
+           import qs from 'qs';
+           console.log(qs.parse(window.location.search.slice(1)))
+         </script>
      </Head>
      <div>
        <p>This is a Fresh app built using JSPM.</p>
      </div>
    </>
  );
}

```
First the `isProduction` variable is added that changes the importmap environment
based on the environment variable `ENV`.
Then as a browser importmap, the `importmap.browser.json` should be read and passed to the `Generator` class. And a reinstall should be done since the
environment variable value might be changed and following that, the importmap
would be altered. On the first run, this might be slow, but since JSPM uses
fetch cache, the next attempts would not take any time.

In the handler, the app converts the html value from the response and then
converts it to a string so it'd be passed to the `htmlInject` function in
generator. And then it returns a new response with the injected html.

In the script module, the `qs` module is loaded using the injected browser
importmap and with the `parse` function, the parsed query string gets logged.

```sh
$ deno task start

Import map diagnostics:
  - Invalid top-level key "env". Only "imports" and
 "scopes" can be present.
Task start deno run -A main.ts
Import map diagnostics:
  - Invalid top-level key "env". Only "imports" and
 "scopes" can be present.
Listening on http://localhost:8000/
```
And by navigating to `http://localhost:8000/?cli=jspm`, and checking the logs in
the browser and server, and this log should be seen both in the browser and the
server.

```
{ cli: "jspm" }
```
