import * as crypto from 'crypto';

export function computeIntegrity (source: string) {
  const hash = crypto.createHash('sha384');
  hash.update(source);
  return 'sha384-' + hash.toString('base64');
}
