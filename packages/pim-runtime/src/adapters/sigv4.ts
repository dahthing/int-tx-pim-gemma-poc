import { createHash, createHmac } from 'node:crypto';

export interface SignV4Input {
  method: string;
  url: string;
  headers?: Record<string, string>;
  payloadSha256: string;
  region: string;
  service: string;
  accessKey: string;
  secretKey: string;
  now?: Date;
}

export const sha256Hex = (data: Buffer | string): string =>
  createHash('sha256').update(data).digest('hex');
const hmac = (key: Buffer | string, data: string): Buffer =>
  createHmac('sha256', key).update(data).digest();

const rfc3986 = (s: string): string =>
  encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/** Canonical URI for S3: each segment percent-encoded once (no double encoding). */
function canonicalPath(pathname: string): string {
  return pathname
    .split('/')
    .map((seg) => rfc3986(decodeURIComponent(seg)))
    .join('/');
}

/** AWS Signature Version 4 (header based). Returns the headers to send, including Authorization. */
export function signRequestV4(i: SignV4Input): {
  headers: Record<string, string>;
  url: string;
} {
  const url = new URL(i.url);
  const now = i.now ?? new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = amzDate.slice(0, 8);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(i.headers ?? {}))
    headers[k.toLowerCase()] = v.trim();
  headers.host = url.host;
  headers['x-amz-date'] = amzDate;
  headers['x-amz-content-sha256'] = i.payloadSha256;

  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n]}\n`).join('');
  const signedHeaders = names.join(';');
  const query = [...url.searchParams.entries()]
    .map(([k, v]) => [rfc3986(k), rfc3986(v)] as const)
    .sort((a, b) =>
      a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1,
    )
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const canonicalRequest = [
    i.method.toUpperCase(),
    canonicalPath(url.pathname),
    query,
    canonicalHeaders,
    signedHeaders,
    i.payloadSha256,
  ].join('\n');
  const scope = `${date}/${i.region}/${i.service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const kSigning = hmac(
    hmac(hmac(hmac(`AWS4${i.secretKey}`, date), i.region), i.service),
    'aws4_request',
  );
  const signature = createHmac('sha256', kSigning)
    .update(stringToSign)
    .digest('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${i.accessKey}/${scope},SignedHeaders=${signedHeaders},Signature=${signature}`;
  return { headers, url: url.toString() };
}
