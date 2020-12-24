export function indent (source: string, indent: string) {
  return source.split('\n').map(line => indent + line).join('\n').slice(indent.length);
}

export function printFrame (source: string, line = 1, _col = 1, _pointer = false, before = Infinity, after = Infinity) {
  const lines = source.split('\n');
  const lineRange = lines.slice(Math.min(line - 1 - before, 0), Math.max(line + after, lines.length));
  let gutterWidth = lineRange.length.toString().length;
  return lineRange.map((line, index) => (index + 1).toString().padStart(gutterWidth, ' ') + '|' + '  ' + line).join('\n');
}
