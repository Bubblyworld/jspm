# Browser
## Initialization
The default environment for the CLI is the browser. If there's no html file in
the directory, it is possible to create a default template html file with an
empty importmap using the `inject` command.

```sh
jspm inject index.html
```
which results in this html file:

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


