import os from 'os';
import { JspmError } from './err.ts';

export interface JsonStyle {
  tab: string,
  newline: string,
  trailingNewline: string,
  indent: string,
  quote: string
};

export const defaultStyle = {
  tab: '  ',
  newline: os.EOL,
  trailingNewline: os.EOL,
  indent: '',
  quote: '"'
};

export function detectStyle (string: string): JsonStyle {
  let style = Object.assign({}, defaultStyle);

  let newLineMatch = string.match( /\r?\n|\r(?!\n)/);
  if (newLineMatch)
    style.newline = newLineMatch[0];

  // best-effort tab detection
  // yes this is overkill, but it avoids possibly annoying edge cases
  let lines = string.split(style.newline);
  let indent;
  for (const line of lines) {
    const curIndent = line.match(/^\s*[^\s]/);
    if (curIndent && (indent === undefined || curIndent.length < indent.length))
      indent = curIndent[0].slice(0, -1);
  }
  if (indent !== undefined)
    style.indent = indent;
  lines = lines.map(line => line.slice(indent.length));
  let tabSpaces = lines.map(line => line.match(/^[ \t]*/)?.[0] || '') || [];
  let tabDifferenceFreqs = new Map<number, number>();
  let lastLength = 0;
  tabSpaces.forEach(tabSpace => {
    let diff = Math.abs(tabSpace.length - lastLength);
    if (diff !== 0)
      tabDifferenceFreqs.set(diff, (tabDifferenceFreqs.get(diff) || 0) + 1);
    lastLength = tabSpace.length;
  });
  let bestTabLength = 0;
  for (const tabLength of tabDifferenceFreqs.keys()) {
    if (!bestTabLength || tabDifferenceFreqs.get(tabLength)! >= tabDifferenceFreqs.get(bestTabLength)!)
      bestTabLength = tabLength;
  }
  // having determined the most common spacing difference length,
  // generate samples of this tab length from the end of each line space
  // the most common sample is then the tab string
  let tabSamples = new Map<string, number>();
  tabSpaces.forEach(tabSpace => {
    let sample = tabSpace.substr(tabSpace.length - bestTabLength);
    tabSamples.set(sample, (tabSamples.get(sample) || 0) + 1);
  });
  let bestTabSample = '';
  Object.keys(tabSamples).forEach(sample => {
    if (!bestTabSample || tabSamples.get(sample)! > tabSamples.get(bestTabSample)!)
      bestTabSample = sample;
  });

  if (bestTabSample)
    style.tab = bestTabSample;

  let quoteMatch = string.match(/"|'/);
  if (quoteMatch)
    style.quote = quoteMatch[0];

  style.trailingNewline = string && string.match(new RegExp(style.newline + '$')) ? style.newline : '';

  return style;
}

export function parseStyled (source: string, fileName?: string): { json: any, style: JsonStyle } {
  // remove any byte order mark
  if (source.startsWith('\uFEFF'))
    source = source.substr(1);

  let style = detectStyle(source);
  try {
    return { json: JSON.parse(source), style };
  }
  catch (e) {
    throw new JspmError(`Error parsing JSON file${fileName ? ' ' + fileName : ''}`);
  }
}

export function stringifyStyled (json: any, style: JsonStyle) {
  let jsonString = JSON.stringify(json, null, style.tab);

  return style.indent + jsonString
      .replace(/([^\\])""/g, '$1' + style.quote + style.quote) // empty strings
      .replace(/([^\\])"/g, '$1' + style.quote)
      .replace(/\n/g, style.newline + style.indent) + (style.trailingNewline || '');
}
