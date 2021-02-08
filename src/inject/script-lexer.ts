let source: string, i: number;

export interface ParsedScript {
  start: number;
  end: number;
  attributes: ParsedAttribute[],
  innerStart: number;
  innerEnd: number;
};

export interface ParsedAttribute {
  nameStart: number;
  nameEnd: number;
  valueStart: number;
  valueEnd: number;
};

export function parseScripts (_source: string) {
  const scripts = [];
  source = _source;
  i = 0;

  let curScript: ParsedScript = { start: -1, end: -1, attributes: [], innerStart: -1, innerEnd: -1 };
  while (i < source.length) {
    while (source.charCodeAt(i++) !== 60 /*<*/)
      if (i === source.length) return scripts;
    const x = i;
    i = x;
    switch (readTagName()) {
      case '!--':
        while (source.charCodeAt(i) !== 45/*-*/ || source.charCodeAt(i + 1) !== 45/*-*/ || source.charCodeAt(i + 2) !== 62/*>*/)
          if (++i === source.length) return scripts;
        i += 3;
        break;
      case 'script':
        curScript.start = i - 8;
        let attr;
        while (attr = scanAttr())
          curScript.attributes.push(attr);
        curScript.innerStart = i;
        while (true) {
          while (source.charCodeAt(i++) !== 60 /*<*/)
            if (i === source.length) return scripts;
          const tag = readTagName();
          if (tag === undefined) return scripts;
          if (tag === '/script') {
            curScript.innerEnd = i - 8;
            while (scanAttr());
            curScript.end = i;
            break;
          }
        }
        scripts.push(curScript);
        curScript = { start: -1, end: -1, attributes: [], innerStart: -1, innerEnd: -1 };
        break;
      case undefined:
        return scripts;
      default:
        while (scanAttr());
    }
  }
  return scripts;
}

function readTagName () {
  let start = i;
  let ch;
  while (!isWs(ch = source.charCodeAt(i++)) && ch !== 62 /*>*/)
    if (i === source.length) return;
  return source.slice(start, ch === 62 ? --i : i - 1);
}

function scanAttr () {
  let ch;
  while (isWs(ch = source.charCodeAt(i)))
    if (++i === source.length) return;
  if (ch === 62 /*>*/) {
    i++;
    return;
  }
  const nameStart = i;
  while (!isWs(ch = source.charCodeAt(i++)) && ch !== 61 /*=*/) {
    if (i === source.length) return;
    if (ch === 62 /*>*/)
      return { nameStart, nameEnd: --i, valueStart: -1, valueEnd: -1 };
  }
  const nameEnd = i - 1;
  if (ch !== 61 /*=*/) {
    while (isWs(ch = source.charCodeAt(i)) && ch !== 61 /*=*/) {
      if (++i === source.length) return;
      if (ch === 62 /*>*/) return;
    }
    if (ch !== 61 /*=*/) return { nameStart, nameEnd, valueStart: -1, valueEnd: -1 };
  }
  while (isWs(ch = source.charCodeAt(i++))) {
    if (i === source.length) return;
    if (ch === 62 /*>*/) return;
  }
  if (ch === 34 /*"*/) {
    const valueStart = i;
    while (source.charCodeAt(i++) !== 34 /*"*/)
      if (i === source.length) return;
    return { nameStart, nameEnd, valueStart, valueEnd: i - 1 };
  }
  else if (ch === 39 /*'*/) {
    const valueStart = i;
    while (source.charCodeAt(i++) !== 39 /*'*/)
      if (i === source.length) return;
    return { nameStart, nameEnd, valueStart, valueEnd: i - 1 };
  }
  else {
    const valueStart = i - 1;
    i++;
    while (!isWs(ch = source.charCodeAt(i)) && ch !== 62 /*>*/)
      if (++i === source.length) return;
    return { nameStart, nameEnd, valueStart, valueEnd: i };
  }
}

function isWs (ch: number) {
  return ch === 32 || ch < 14 && ch > 8;
}

function logScripts (source: string, scripts: ParsedScript[]) {
  for (const script of scripts) {
    for (const { nameStart, nameEnd, valueStart, valueEnd } of script.attributes) {
      console.log('Name: ' + source.slice(nameStart, nameEnd));
      if (valueStart !== -1)
        console.log('Value: ' + source.slice(valueStart, valueEnd));
    }
    console.log('"' + source.slice(script.innerStart, script.innerEnd) + '"');
    console.log('"' + source.slice(script.start, script.end) + '"');
  }
}

if (import.meta.main) {
  const { assertStrictEquals } = await import('https://deno.land/std/testing/asserts.ts');
  console.group('Simple script');
  {
    const source = `
      <script type="module">test</script>
      <script src="hi" jspm-preload></script>
    `;
    const scripts = parseScripts(source);
    assertStrictEquals(scripts.length, 2);
    assertStrictEquals(scripts[0].attributes.length, 1);
    const attr = scripts[0].attributes[0];
    assertStrictEquals(source.slice(attr.nameStart, attr.nameEnd), "type");
    assertStrictEquals(source.slice(attr.valueStart, attr.valueEnd), "module");
    assertStrictEquals(scripts[0].innerStart, 29);
    assertStrictEquals(scripts[0].innerEnd, 33);
    assertStrictEquals(scripts[0].start, 7);
    assertStrictEquals(scripts[0].end, 42);
    assertStrictEquals(scripts[1].start, 49);
    assertStrictEquals(scripts[1].end, 88);
    assertStrictEquals(scripts[1].attributes.length, 2);
  }
  console.groupEnd();

  console.group('Edge cases');
  {
    const source = `
    <!-- <script>
      <!-- /* </script> */ ->
      console.log('hmm');
    </script
    
    <script>
      console.log('hi');
    </script>
    
    
    -->
    
    <script ta"    ==='s'\\>
      console.log('test');
    </script>
    
    <script <!-- <p type="module">
      export var p = 5;
      console.log('hi');
    </script type="test"
    >
    
    

    `;
    const scripts = parseScripts(source);
    assertStrictEquals(scripts.length, 2);
    assertStrictEquals(scripts[0].attributes.length, 1);
    let attr = scripts[0].attributes[0];
    assertStrictEquals(source.slice(attr.nameStart, attr.nameEnd), 'ta"');
    assertStrictEquals(source.slice(attr.valueStart, attr.valueEnd), '===\'s\'\\');
    assertStrictEquals(scripts[0].innerStart, 195);
    assertStrictEquals(scripts[0].innerEnd, 227);
    assertStrictEquals(scripts[0].start, 172);
    assertStrictEquals(scripts[0].end, 236);
    assertStrictEquals(scripts[1].attributes.length, 3);
    attr = scripts[1].attributes[0];
    assertStrictEquals(source.slice(attr.nameStart, attr.nameEnd), '<!--');
    assertStrictEquals(attr.valueStart, -1);
    assertStrictEquals(attr.valueEnd, -1);
    attr = scripts[1].attributes[1];
    assertStrictEquals(source.slice(attr.nameStart, attr.nameEnd), '<p');
    assertStrictEquals(attr.valueStart, -1);
    assertStrictEquals(attr.valueEnd, -1);
    attr = scripts[1].attributes[2];
    assertStrictEquals(source.slice(attr.nameStart, attr.nameEnd), 'type');
    assertStrictEquals(source.slice(attr.valueStart, attr.valueEnd), 'module');
    assertStrictEquals(scripts[1].innerStart, 276);
    assertStrictEquals(scripts[1].innerEnd, 331);
    assertStrictEquals(scripts[1].start, 246);
    assertStrictEquals(scripts[1].end, 356);
  }
  console.groupEnd();
}