# Browser
The default environment for the CLI is the browser, which allows the users to
treat JSPM as a modern importmap package manager.

## Initialization

If there's no HTML file in the directory, it is possible to create a HTML file with an
empty importmap using the `inject` command.

```sh
jspm inject index.html
```
which results in this content:

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <title>JSPM example</title>
    <script async src="https://ga.jspm.io/npm:es-module-shims@1.6.3/dist/es-module-shims.js" crossorigin="anonymous"></script>
<script type="importmap">
{}
</script>
  </head>
  <body>
  </body>
</html>
```
If there was an importmap already (`importmap.json` or an importmap provided by
the `--map` option flag), then the script tag would have the provided importmap
instead of an empty one, which is the main use case of the `inject` command.

## Entry
The goal of this section is to write a React application that renders a "Hello,
JSPM" text into the page. It's possible to achieve that, in a single file called
`index.js` with this content:
```js
import React from 'react'
import ReactDOM from 'react-dom'

ReactDOM.render(
  React.createElement('div', null, 'Hello, JSPM'),
  document.getElementById('root')
)
```
And the `index.html` file should be changed to have a `#root` element and a
script tag that loads the `index.js` file.
```diff
  <body>
+    <div id="root"></div>
+    <script src="./index.js" type="module"></script>
  </body>
```

## Linking (Tracing)

Since the importmap has none of those React dependencies, the CLI provides a
feature called **Linking** or **Tracing**. Which by passing a list of modules,
the CLI will install all the required dependencies of those modules
automatically.
```sh
jspm link ./index.js
```
This will transform our empty importmap into this one:
```json
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
```
And then by running `jspm inject index.html`, the `index.html` will receive the
new importmap.

> The `inject` command does the linking by default, so by running only this command, the `index.html` file would also receive the new dependencies.

## Running

Now by executing this command, this tiny react application would be available on
`http://localhost:8080`:

```sh
npx http-server ./
```
