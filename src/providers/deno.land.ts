export const cdnUrl = 'https://x.nest.land/';

export function getPackageBase (url: string): string {
  return cdnUrl + url.slice(cdnUrl.length).split('/').shift() + '/';
}

