import { execFileSync } from 'node:child_process'
import test from 'node:test'

function restrictedRuntime(source) {
  execFileSync(process.execPath, ['--no-experimental-require-module', '-e', source], {
    cwd: new URL('..', import.meta.url), timeout: 15_000, stdio: 'pipe',
  })
}

test('Firebase Admin loads without require(ESM) and still rejects malformed student tokens', () => {
  restrictedRuntime(`
    const assert = require('node:assert/strict');
    const { initializeApp, deleteApp } = require('firebase-admin/app');
    const { getAuth } = require('firebase-admin/auth');
    require('firebase-admin/firestore');
    (async () => {
      const app = initializeApp({ projectId: 'runtime-regression-test' });
      try {
        await assert.rejects(getAuth(app).verifyIdToken('not-a-token'), error =>
          ['auth/argument-error', 'auth/invalid-id-token'].includes(error.code));
      } finally { await deleteApp(app); }
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `)
})

test('JWKS loading and passport integration preserve usable RSA verification keys', () => {
  restrictedRuntime(`
    const assert = require('node:assert/strict');
    const crypto = require('node:crypto');
    const { createRequire } = require('node:module');
    const adminRequire = createRequire(require.resolve('firebase-admin/auth'));
    const jwks = adminRequire('jwks-rsa');
    (async () => {
      const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
      const key = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' };
      const options = { jwksUri: 'https://example.invalid/jwks', cache: false, fetcher: async () => ({ keys: [key] }) };
      const client = jwks(options);
      const signingKey = await client.getSigningKey('test-key');
      const data = Buffer.from('a test message, not a student token');
      const signature = crypto.sign('RSA-SHA256', data, privateKey);
      assert.equal(crypto.verify('RSA-SHA256', data, signingKey.getPublicKey(), signature), true);
      assert.equal(crypto.verify('RSA-SHA256', Buffer.from('changed message'), signingKey.getPublicKey(), signature), false);
      await assert.rejects(client.getSigningKey('missing-key'), /Unable to find a signing key/);

      const provider = jwks.passportJwtSecret(options);
      const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({ sub: 'test-user' })).toString('base64url');
      const content = header + '.' + payload;
      const jwt = content + '.' + crypto.sign('RSA-SHA256', Buffer.from(content), privateKey).toString('base64url');
      const passportKey = await new Promise((resolve, reject) => provider({}, jwt, (error, value) => error ? reject(error) : resolve(value)));
      assert.equal(crypto.verify('RSA-SHA256', data, passportKey, signature), true);
      const invalid = await new Promise((resolve, reject) => provider({}, 'invalid-token', (error, value) => error ? reject(error) : resolve(value)));
      assert.equal(invalid, null);
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `)
})
