declare module 'magic-string' {
  // @ts-ignore
  export * from 'https://unpkg.com/magic-string@0.25.7/index.d.ts';
  // @ts-ignore
  export { default } from 'https://unpkg.com/magic-string@0.25.7/index.d.ts';
}

declare module 'chalk' {
  // @ts-ignore
  import * as chalk from 'https://unpkg.com/chalk@4.1.0/index.d.ts';
  export default chalk;
}

declare module '@iarna/toml' {
  namespace toml {
    export function parse (input: string): any;
    export function stringify (input: any): string;
  }
  export default toml;
}

declare module 'path' {
  // @ts-ignore
  import * as path from 'https://deno.land/std/node/path.ts';
  // @ts-ignore
  export * from 'https://deno.land/std/node/path.ts';
  export default path;
}

declare module 'sver/convert-range.js' {
  // @ts-ignore
  import { SemverRange } from 'https://ga.jspm.io/npm:sver@1.8.3/sver.js';
  export default function convertRange (range: string): typeof SemverRange;
}

declare module 'crypto' {
  export const createHash: any;
}

declare module 'mkdirp';
