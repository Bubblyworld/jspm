import '../deps.ts';
import MagicString from 'magic-string';
import { ParsedTag } from './script-lexer.ts';
import { detectNewline, detectStyle } from '../common/source-style.ts';
import { parseTags } from './script-lexer.ts';

const ws = /\s+/;
function detectSpace (source: string, index: number) {
  const nl = source.lastIndexOf('\n', index);
  if (nl !== -1) {
    const detectedSpace = source.slice(nl, index);
    if (detectedSpace.match(ws))
      return detectedSpace;
  }
  return detectNewline(source);
}

export function removeElement (source: MagicString, el: { start: number, end: number }) {
  const spaceLen = detectSpace(source.original, el.start).length;
  source.remove(el.start - spaceLen, el.end);
}

function isJspmUrl (url: string) {
  return url.startsWith('https://ga.jspm.io/') || url.startsWith('https://system.ga.jspm.io/');
}

// anything to jspm CDN or with attribute "jspm"
export function removeJspmInjections (source: MagicString, els: ParsedTag[]) {
  for (const el of els) {
    if (el.name === 'script') {
      if (el.attributes.some(attr => attr.name === 'jspm' || attr.name === 'src' && isJspmUrl(attr.value)))
        removeElement(source, el);
    }
    else if (el.name === 'link') {
      if (el.attributes.some(attr => attr.name === 'jspm' || attr.name === 'rel' && isJspmUrl(attr.value)))
        removeElement(source, el);
    }
  }
}

export function insertAfter (source: MagicString, el: { start: number, end: number }, injection: string) {
  const detectedSpace = detectSpace(source.original, el.start);
  source.appendLeft(el.end, detectedSpace + injection);
}

export function insertBefore (source: MagicString, el: { start: number, end: number }, injection: string) {
  const detectedSpace = detectSpace(source.original, el.start);
  source.appendLeft(el.start, injection + detectedSpace);
}

export function append (source: MagicString, el: { start: number, end: number, innerStart: number, innerEnd: number }, injection: string) {
  const { tab } = detectStyle(source.original);
  const detectedSpace = detectSpace(source.original, el.start);
  source.appendLeft(el.end, detectedSpace + tab + injection);
}

export function setInnerWithIndentation (source: MagicString, el: { start: number, end: number, innerStart: number, innerEnd: number }, injection: string) {
  const nl = detectNewline(source.original);
  const detectedSpace = detectSpace(source.original, el.start);
  source.overwrite(el.innerStart, el.innerEnd, nl + injection.split('\n').map(line => detectedSpace.slice(1) + line).join('\n') + nl + detectedSpace.slice(1));
}

export function getOrCreateTag (source: MagicString, els: ParsedTag[], detect: (el: ParsedTag) => boolean, injection: string | null): { source: MagicString, els: ParsedTag[], map: ParsedTag } {
  for (const el of els) {
    if (detect(el))
      return { source, els, map: el };
  }

  if (injection === null)
    throw new Error('Internal Error: Unexpected injection');

  // end of head
  for (const el of els) {
    if (el.name === 'head') {
      append(source, el, injection);
      const output = source.toString();
      return getOrCreateTag(new MagicString(output), parseTags(output), detect, null);
    }
  }

  // top of body
  for (const el of els) {
    if (el.name === 'body') {
      insertBefore(source, el, injection);
      const output = source.toString();
      return getOrCreateTag(new MagicString(output), parseTags(output), detect, null);
    }
  }

  // top of HTML, whatever
  if (els.length) {
    insertBefore(source, els[0], injection);
    const output = source.toString();
    return getOrCreateTag(new MagicString(output), parseTags(output), detect, null);
  }

  const nl = detectNewline(source.original);
  const output = injection + nl + source.toString();
  return getOrCreateTag(new MagicString(output), parseTags(output), detect, null);
}

if (import.meta.main) {
  const { assertStrictEquals } = await import('https://deno.land/std/testing/asserts.ts');
  console.group('Simple removal');
  {
    const source = `
      <script type="module">test</script>
      <script src="hi" jspm-preload></script>
      <link rel="modulepreload" />
    `;
    const string = new MagicString(source);
    const scripts = parseTags(source);
    removeElement(string, scripts[2]);
    assertStrictEquals(string.toString(), `
      <script type="module">test</script>
      <script src="hi" jspm-preload></script>
    `);
  }
  {
    const source = `
      <script type="module">test</script>
      <script src="hi" jspm-preload></script>
      <link rel="modulepreload" />
    `;
    const string = new MagicString(source);
    const scripts = parseTags(source);
    removeElement(string, scripts[1]);
    assertStrictEquals(string.toString(), `
      <script type="module">test</script>
      <link rel="modulepreload" />
    `);
  }
  {
    const source = `
      <script type="module">test</script>
      <script type="importmap">
      {
        "imports": { "stuff": "..." }
      }
        </script>
      <link rel="modulepreload" />
    `;
    const string = new MagicString(source);
    const scripts = parseTags(source);
    removeElement(string, scripts[1]);
    assertStrictEquals(string.toString(), `
      <script type="module">test</script>
      <link rel="modulepreload" />
    `);
  }
  console.groupEnd();

  console.group('Injections Removal');
  {
    const source = `
      <script type="module" src=https://ga.jspm.io/x></script>
      <script type="importmap">
      {
        "imports": { "stuff": "..." }
      }
        </script>
      <link rel="modulepreload" href="./dist/x-sdf.js" jspm />
    `;
    const string = new MagicString(source);
    const scripts = parseTags(source);
    removeJspmInjections(string, scripts);
    assertStrictEquals(string.toString(), `
      <script type="importmap">
      {
        "imports": { "stuff": "..." }
      }
        </script>
    `);
  }
  console.groupEnd();

  console.group('Modification');
  {
    const source = `
      <script type="module">test</script>
      <script type="importmap">
      {
        "imports": { "stuff": "..." }
      }
        </script>
      <link rel="modulepreload" />
    `;
    const string = new MagicString(source);
    const scripts = parseTags(source);
    setInnerWithIndentation(string, scripts[1], JSON.stringify({ hello: 'world' }, null, 2));
    assertStrictEquals(string.toString(), `
      <script type="module">test</script>
      <script type="importmap">
      {
        "hello": "world"
      }
      </script>
      <link rel="modulepreload" />
    `);
  }
  console.groupEnd();

  console.group('Insert After');
  {
    const source = `
      <script type="module">test</script>
      <script type="importmap">
      {
        "imports": { "stuff": "..." }
      }
        </script>
      <link rel="modulepreload" />
    `;
    const string = new MagicString(source);
    const scripts = parseTags(source);
    insertAfter(string, scripts[1], '<link rel="modulepreload">');
    assertStrictEquals(string.toString(), `
      <script type="module">test</script>
      <script type="importmap">
      {
        "imports": { "stuff": "..." }
      }
        </script>
      <link rel="modulepreload">
      <link rel="modulepreload" />
    `);
  }
  {
    const source = `
      <script type="module">test</script>
      <script type="importmap">
      {
        "imports": { "stuff": "..." }
      }
        </script>
      <after>
    `;
    const string = new MagicString(source);
    const scripts = parseTags(source);
    insertAfter(string, scripts[1], '<link rel="modulepreload">');
    assertStrictEquals(string.toString(), `
      <script type="module">test</script>
      <script type="importmap">
      {
        "imports": { "stuff": "..." }
      }
        </script>
      <link rel="modulepreload">
      <after>
    `);
  }
  {
    const source = `<script type="importmap"></script>`;
    const string = new MagicString(source);
    const scripts = parseTags(source);
    insertAfter(string, scripts[0], '<link rel="modulepreload">');
    insertAfter(string, scripts[0], '<link rel="modulepreload">');
    assertStrictEquals(string.toString(), `<script type="importmap"></script>
<link rel="modulepreload">
<link rel="modulepreload">`);
  }
  console.groupEnd();

  console.group('Append');
  {
    const source = `
      <head>
      <body>
    `;
    const string = new MagicString(source);
    const scripts = parseTags(source);
    append(string, scripts[0], '<link rel="modulepreload">');
    assertStrictEquals(string.toString(), `
      <head>
        <link rel="modulepreload">
      <body>
    `);
  }
  console.groupEnd();

  console.group('Insert Before');
  {
    const source = `
      <script type="module">test</script>
      <script type="importmap">
      {
        "imports": { "stuff": "..." }
      }
        </script>
      <link rel="modulepreload" />
    `;
    const string = new MagicString(source);
    const scripts = parseTags(source);
    insertBefore(string, scripts[1], '<link rel="modulepreload">');
    assertStrictEquals(string.toString(), `
      <script type="module">test</script>
      <link rel="modulepreload">
      <script type="importmap">
      {
        "imports": { "stuff": "..." }
      }
        </script>
      <link rel="modulepreload" />
    `);
  }
  console.groupEnd();

  console.group('GetOrCreateImportMap');
  {
    const source = `
      <head>
      <body>
    `;
    const string = new MagicString(source);
    const scripts = parseTags(source);
    {
      const { source, els, map } = getOrCreateTag(string, scripts, el => el.name === 'script' && el.attributes.some(attr => attr.name === 'type' && attr.value === 'importmap'), '<script type="importmap"></script>');
      assertStrictEquals(source.toString(), `
      <head>
        <script type="importmap"></script>
      <body>
    `);
      assertStrictEquals(map.start, 22);
      const { map: innerMap } = getOrCreateTag(source, els, el => el.name === 'script' && el.attributes.some(attr => attr.name === 'type' && attr.value === 'importmap'), '<script type="importmap"></script>');
      assertStrictEquals(map, innerMap);
    }
  }
  console.groupEnd();
}
