import { beforeAll, describe, expect, it } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from 'jose';
import { accessIssuer, verifyAccessToken } from '../../src/worker/http/auth';

const env = { ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com', ACCESS_AUD: 'expected-audience' };
let keys: JWTVerifyGetKey;
let privateKey: CryptoKey;
beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  keys = createLocalJWKSet({
    keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'test-key', alg: 'RS256' }],
  });
});
async function token({
  audience = env.ACCESS_AUD,
  issuer = 'https://team.cloudflareaccess.com',
  expiration = '1h',
  email = 'admin@example.com',
} = {}) {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject('user')
    .setIssuedAt()
    .setExpirationTime(expiration)
    .sign(privateKey);
}
describe('Cloudflare Access verification', () => {
  it('verifies the signature and identity', async () => {
    expect(await verifyAccessToken(await token(), env, keys)).toEqual({ email: 'admin@example.com' });
  });
  it.each([
    { audience: 'another-application' },
    { issuer: 'https://attacker.cloudflareaccess.com' },
    { expiration: '-1h' },
    { email: '' },
  ])('rejects invalid claims %j', async (options) => {
    await expect(verifyAccessToken(await token(options), env, keys)).rejects.toThrow();
  });
  it('rejects a token signed with an unrelated private key', async () => {
    const attacker = await generateKeyPair('RS256');
    const forged = await new SignJWT({ email: 'admin@example.com' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer('https://team.cloudflareaccess.com')
      .setAudience(env.ACCESS_AUD)
      .setSubject('user')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(attacker.privateKey);
    await expect(verifyAccessToken(forged, env, keys)).rejects.toThrow();
  });
  it('requires expiration and rejects token decoding without verification', async () => {
    const noExpiry = await new SignJWT({ email: 'admin@example.com' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer('https://team.cloudflareaccess.com')
      .setAudience(env.ACCESS_AUD)
      .setSubject('user')
      .setIssuedAt()
      .sign(privateKey);
    await expect(verifyAccessToken(noExpiry, env, keys)).rejects.toThrow();
    await expect(
      verifyAccessToken('eyJhbGciOiJub25lIn0.eyJlbWFpbCI6ImFkbWluQGV4YW1wbGUuY29tIn0.', env, keys),
    ).rejects.toThrow();
  });
  it('accepts only the configured Cloudflare team hostname as key source', () => {
    expect(accessIssuer('https://team.cloudflareaccess.com/')).toBe('https://team.cloudflareaccess.com');
    for (const value of [
      'http://team.cloudflareaccess.com',
      'team.cloudflareaccess.com.evil.test',
      'team.cloudflareaccess.com@evil.test',
      'localhost',
      'team.cloudflareaccess.com/path',
    ])
      expect(() => accessIssuer(value)).toThrow();
  });
});
