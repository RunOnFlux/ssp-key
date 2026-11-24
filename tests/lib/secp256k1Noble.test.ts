/**
 * src/lib/secp256k1Noble.js must behave exactly like secp256k1@5's elliptic
 * backend — the implementation the multisig SDK ran on in React Native — for
 * every function the SDK calls: same bytes, same errors, same in-place
 * private-key updates. Metro swaps it in for the SDK only (metro.config.js).
 */
import path from 'path';
import { randomBytes } from 'crypto';

const noble = require('../../src/lib/secp256k1Noble.js');
const SDK_SECP256K1 = path.join(
  __dirname,
  '../../node_modules/@runonflux/aa-schnorr-multisig-sdk/node_modules/secp256k1',
);
const reference = require(path.join(SDK_SECP256K1, 'elliptic.js'));

const N = BigInt(
  '0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141',
);
const P = BigInt(
  '0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f',
);
const bytes32 = (value: bigint) =>
  Uint8Array.from(Buffer.from(value.toString(16).padStart(64, '0'), 'hex'));
const rand32 = () => new Uint8Array(randomBytes(32));
const randKey = () => {
  for (;;) {
    const k = rand32();
    if (reference.privateKeyVerify(k)) return k;
  }
};
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

/** Runs fn on both implementations; same result bytes or same error text. */
function same(fn: (lib: typeof reference) => unknown) {
  const run = (lib: typeof reference) => {
    try {
      const value = fn(lib);
      return {
        ok: true,
        value: value instanceof Uint8Array ? hex(value) : value,
      };
    } catch (error) {
      return { ok: false, value: (error as Error).message };
    }
  };
  expect(run(noble)).toEqual(run(reference));
}

const ROUNDS = 60;

describe('secp256k1Noble — parity with secp256k1@5 (elliptic)', () => {
  it('privateKeyVerify, including 0, n-1, n and above', () => {
    for (const k of [0n, 1n, N - 1n, N, N + 1n, 2n ** 256n - 1n]) {
      same((lib) => lib.privateKeyVerify(bytes32(k)));
    }
    for (let i = 0; i < ROUNDS; i++) {
      const k = rand32();
      same((lib) => lib.privateKeyVerify(k));
    }
  });

  it('publicKeyCreate, compressed and uncompressed, valid and invalid', () => {
    for (let i = 0; i < ROUNDS; i++) {
      const k = randKey();
      same((lib) => lib.publicKeyCreate(k));
      same((lib) => lib.publicKeyCreate(k, false));
    }
    for (const k of [0n, N, N + 5n]) {
      same((lib) => lib.publicKeyCreate(bytes32(k)));
    }
    same((lib) => lib.publicKeyCreate(new Uint8Array(31)));
    same((lib) => lib.publicKeyCreate(randKey(), 'yes'));
  });

  it('publicKeyConvert / publicKeyVerify across formats, including hybrid and invalid keys', () => {
    for (let i = 0; i < ROUNDS; i++) {
      const k = randKey();
      const compressed = reference.publicKeyCreate(k);
      const full = reference.publicKeyCreate(k, false);
      const hybridGood = Uint8Array.from(full);
      hybridGood[0] = full[64] & 1 ? 0x07 : 0x06;
      const hybridBad = Uint8Array.from(full);
      hybridBad[0] = full[64] & 1 ? 0x06 : 0x07;
      for (const key of [compressed, full, hybridGood, hybridBad]) {
        same((lib) => lib.publicKeyVerify(key));
        same((lib) => lib.publicKeyConvert(key));
        same((lib) => lib.publicKeyConvert(key, false));
      }
    }
    const xTooBig = Uint8Array.from([0x02, ...bytes32(P + 1n)]);
    const notOnCurve = Uint8Array.from([0x02, ...bytes32(5n)]);
    const badPrefix = Uint8Array.from([0x05, ...rand32()]);
    const badUncompressed = Uint8Array.from([0x04, ...rand32(), ...rand32()]);
    for (const key of [xTooBig, notOnCurve, badPrefix, badUncompressed]) {
      same((lib) => lib.publicKeyVerify(key));
      same((lib) => lib.publicKeyConvert(key));
    }
    same((lib) => lib.publicKeyConvert(new Uint8Array(40)));
  });

  it('publicKeyCombine for 1–6 keys, cancelling keys and invalid keys', () => {
    for (let i = 0; i < ROUNDS; i++) {
      const keys = Array.from({ length: 1 + (i % 6) }, () =>
        reference.publicKeyCreate(randKey(), i % 2 === 0),
      );
      same((lib) => lib.publicKeyCombine(keys));
      same((lib) => lib.publicKeyCombine(keys, false));
    }
    const k = randKey();
    const pub = reference.publicKeyCreate(k);
    const negated = Uint8Array.from(pub);
    negated[0] = pub[0] === 0x02 ? 0x03 : 0x02;
    same((lib) => lib.publicKeyCombine([pub, negated]));
    same((lib) =>
      lib.publicKeyCombine([pub, Uint8Array.from([0x02, ...bytes32(5n)])]),
    );
    same((lib) => lib.publicKeyCombine([]));
    same((lib) => lib.publicKeyCombine('nope'));
  });

  it('publicKeyTweakMul, including out-of-range tweaks', () => {
    for (let i = 0; i < ROUNDS; i++) {
      const pub = reference.publicKeyCreate(randKey(), i % 2 === 0);
      const tweak = rand32();
      same((lib) => lib.publicKeyTweakMul(pub, tweak));
      same((lib) => lib.publicKeyTweakMul(pub, tweak, false));
    }
    const pub = reference.publicKeyCreate(randKey());
    for (const t of [0n, 1n, N - 1n, N, N + 1n]) {
      same((lib) => lib.publicKeyTweakMul(pub, bytes32(t)));
    }
  });

  it('privateKeyTweakAdd / privateKeyTweakMul update the key in place, edge cases included', () => {
    const cases: Array<[bigint, bigint]> = [
      [1n, 1n],
      [N - 1n, 1n],
      [N - 1n, N - 1n],
      [5n, N - 5n],
      [0n, 7n],
      [N + 3n, 2n],
      [3n, N],
      [3n, 0n],
    ];
    for (let i = 0; i < ROUNDS; i++)
      cases.push([toBig(rand32()), toBig(rand32())]);
    for (const [k, t] of cases) {
      for (const fn of ['privateKeyTweakAdd', 'privateKeyTweakMul'] as const) {
        const a = bytes32(k % 2n ** 256n);
        const b = Uint8Array.from(a);
        const tweak = bytes32(t % 2n ** 256n);
        let ra: string;
        let rb: string;
        try {
          ra = hex(noble[fn](a, tweak));
        } catch (e) {
          ra = (e as Error).message;
        }
        try {
          rb = hex(reference[fn](b, tweak));
        } catch (e) {
          rb = (e as Error).message;
        }
        expect(ra).toBe(rb);
        expect(hex(a)).toBe(hex(b)); // same in-place update
      }
    }
  });

  it('honours the output argument like the wrapper', () => {
    const k = randKey();
    same((lib) => lib.publicKeyCreate(k, true, new Uint8Array(33)));
    same((lib) => lib.publicKeyCreate(k, true, new Uint8Array(32)));
    same((lib) =>
      lib.publicKeyCreate(k, false, (len: number) => new Uint8Array(len)),
    );
  });

  it('refuses functions the SDK does not use', () => {
    expect(() => noble.ecdsaSign(rand32(), randKey())).toThrow(
      /not implemented/,
    );
  });
});

function toBig(b: Uint8Array): bigint {
  return BigInt('0x' + Buffer.from(b).toString('hex'));
}

describe('multisig SDK on the noble backend', () => {
  // The SDK resolves its own nested secp256k1@5, so mock that exact file
  // (a bare 'secp256k1' would resolve to the app's top-level 3.x and never
  // reach the SDK). The counter proves the noble path actually ran.
  const SDK_SECP256K1_ENTRY = path.join(SDK_SECP256K1, 'index.js');
  let nobleCalls = 0;
  const loadSdk = (useNoble: boolean) => {
    let sdk: typeof import('@runonflux/aa-schnorr-multisig-sdk') | undefined;
    jest.isolateModules(() => {
      if (useNoble) {
        jest.doMock(SDK_SECP256K1_ENTRY, () => {
          const impl = jest.requireActual('../../src/lib/secp256k1Noble.js');
          return new Proxy(impl, {
            get: (target, key) => {
              nobleCalls += 1;
              return target[key];
            },
          });
        });
      } else {
        jest.doMock(SDK_SECP256K1_ENTRY, () =>
          jest.requireActual(path.join(SDK_SECP256K1, 'elliptic.js')),
        );
      }
      sdk = require('@runonflux/aa-schnorr-multisig-sdk');
    });
    jest.dontMock(SDK_SECP256K1_ENTRY);
    return sdk!;
  };

  const viaNoble = loadSdk(true);
  const viaElliptic = loadSdk(false);

  afterAll(() => {
    expect(nobleCalls).toBeGreaterThan(0);
  });
  const privKeys = Array.from(
    { length: 6 },
    () => ('0x' + Buffer.from(randKey()).toString('hex')) as `0x${string}`,
  );

  it('derives the same vault addresses (all M-of-N combinations)', () => {
    const keysOf = (sdk: typeof viaNoble) =>
      privKeys.map((pk) =>
        sdk.helpers.SchnorrHelpers.createSchnorrSigner(pk).getPubKey(),
      );
    expect(
      viaNoble.helpers.SchnorrHelpers.getAllCombinedAddrFromKeysStrict(
        keysOf(viaNoble),
        4,
      ),
    ).toEqual(
      viaElliptic.helpers.SchnorrHelpers.getAllCombinedAddrFromKeysStrict(
        keysOf(viaElliptic),
        4,
      ),
    );
    expect(
      viaNoble.helpers.SchnorrHelpers.getAllCombinedAddrFromKeys(
        keysOf(viaNoble).slice(0, 2),
        2,
      ),
    ).toEqual(
      viaElliptic.helpers.SchnorrHelpers.getAllCombinedAddrFromKeys(
        keysOf(viaElliptic).slice(0, 2),
        2,
      ),
    );
  });

  it('a 2-of-2 signature made on noble verifies with the elliptic build', () => {
    const hash = ('0x' +
      Buffer.from(rand32()).toString('hex')) as `0x${string}`;
    const signers = privKeys
      .slice(0, 2)
      .map((pk) => viaNoble.helpers.SchnorrHelpers.createSchnorrSigner(pk));
    const keys = signers.map((s) => s.getPubKey());
    const nonces = signers.map((s) => s.generatePubNonces());
    const parts = signers.map((s) => s.signMultiSigHash(hash, keys, nonces));
    const summed = viaNoble.helpers.SchnorrHelpers.sumSchnorrSigs(
      parts.map((p) => p.signature),
    );

    // verify with the elliptic-backed SDK
    const { Schnorrkel } = viaElliptic.signers as unknown as {
      Schnorrkel: {
        getCombinedPublicKey: (k: unknown[]) => unknown;
        verifyHash: (...args: unknown[]) => boolean;
      };
    };
    const ellipticKeys = privKeys
      .slice(0, 2)
      .map((pk) =>
        viaElliptic.helpers.SchnorrHelpers.createSchnorrSigner(pk).getPubKey(),
      );
    const combined = Schnorrkel.getCombinedPublicKey(ellipticKeys);
    expect(
      Schnorrkel.verifyHash(summed, hash, parts[0].finalPublicNonce, combined),
    ).toBe(true);
  });
});
