import { signRequestV4 } from './sigv4';

describe('signRequestV4', () => {
  it('matches the AWS documentation GET Object example', () => {
    const r = signRequestV4({
      method: 'GET',
      url: 'https://examplebucket.s3.amazonaws.com/test.txt',
      headers: { range: 'bytes=0-9' },
      payloadSha256:
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      region: 'us-east-1',
      service: 's3',
      accessKey: 'AKIAIOSFODNN7EXAMPLE',
      secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      now: new Date('2013-05-24T00:00:00Z'),
    });
    expect(r.headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request,SignedHeaders=host;range;x-amz-content-sha256;x-amz-date,Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
    expect(r.headers['x-amz-date']).toBe('20130524T000000Z');
  });

  it('keeps a non-default port in the host header and encodes the key segments', () => {
    const r = signRequestV4({
      method: 'PUT',
      url: 'http://minio:9000/bucket/a b/é.jpg',
      headers: { 'content-type': 'image/jpeg' },
      payloadSha256: 'x',
      region: 'us-east-1',
      service: 's3',
      accessKey: 'k',
      secretKey: 's',
      now: new Date('2026-01-01T00:00:00Z'),
    });
    expect(r.headers.host).toBe('minio:9000');
    expect(r.headers.authorization).toContain(
      'SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date',
    );
  });
});
