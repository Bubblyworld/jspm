# Browser
The default environment for the CLI is the browser, which allows the users to
treat JSPM as a modern importmap package manager.
In this workflow, the users go through the CLI integration of an existing `index.html`
file and a javascript file that has a React app.

## Initialization

`index.html`:
```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <title>JSPM example</title>
  </head>
  <body>
    <div id="root"></div>
    <script src="./index.js" type="module"></script>
  </body>
</html>
```
And the `index.js` is a simple React file with no JSX.
```js
import React from 'react'
import ReactDOM from 'react-dom'

ReactDOM.render(
  React.createElement('div', null, 'Hello, JSPM'),
  document.getElementById('root')
)
```

## Linking (Tracing)

Since there is no importmap that has any of these React dependencies, the CLI provides a
feature called **Linking** or **Tracing**. Which by passing a list of modules,
the CLI will install all the required dependencies of those modules
automatically.
The purpose of this feature can be achieved using the `inject` or `link`
command, which in case of html files, the former one is simpler.
```sh
jspm inject index.html
```
This will inject a new importmap into our `index.html` using the trace feature:

`index.html`:
```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <title>JSPM example</title>
  </head>
  <body>
    <div id="root"></div>
    <script async src="https://ga.jspm.io/npm:es-module-shims@1.6.3/dist/es-module-shims.js" crossorigin="anonymous"></script>
    <script type="importmap">
    {
      "imports": {
        "react": "https://ga.jspm.io/npm:react@18.2.0/dev.index.js",
        "react-dom": "https://ga.jspm.io/npm:react-dom@18.2.0/dev.index.js"
      },
      "scopes": {
        "https://ga.jspm.io/": {
          "scheduler": "https://ga.jspm.io/npm:scheduler@0.23.0/dev.index.js"
        }
      }
    }
    </script>
    <script src="./index.js" type="module"></script>
  </body>
</html>
```
And now the application has those dependencies through JSPM, and it can run in
the server using the importmap.

## Running

Now by executing this command, this tiny react application would be available on
`http://localhost:8080`:

```sh
npx http-server ./
```

## Production

In the importmap, it can be seen that the React dependencies end with
`/dev.index.js` expression, which shows that those dependencies are in the
development mode. It can be easily switched using the `--env` flag in the CLI.
```sh
jspm inject index.html --env=production
```

And now the dependencies get the production mode instead of the development
mode.

`index.html`:
```diff
    <script type="importmap">
-    {
-      "imports": {
-        "react": "https://ga.jspm.io/npm:react@18.2.0/dev.index.js",
-        "react-dom": "https://ga.jspm.io/npm:react-dom@18.2.0/dev.index.js"
-      },
-      "scopes": {
-        "https://ga.jspm.io/": {
-          "scheduler": "https://ga.jspm.io/npm:scheduler@0.23.0/dev.index.js"
-        }
-      }
-    }
+    {
+      "imports": {
+        "react": "https://ga.jspm.io/npm:react@18.2.0/index.js",
+        "react-dom": "https://ga.jspm.io/npm:react-dom@18.2.0/index.js"
+      },
+      "scopes": {
+        "https://ga.jspm.io/": {
+          "scheduler": "https://ga.jspm.io/npm:scheduler@0.23.0/index.js"
+        }
+      }
+    }
    </script>
```
