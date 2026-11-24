/**
 * EVM vault addresses are cached per session (src/lib/vaultDescriptor.ts): a
 * repeat derivation returns the same address without rebuilding every M-of-N
 * combined key, and the cached value is the one the shared vectors pin.
 */
import fs from 'fs';
import path from 'path';
import * as aaSchnorrMultisig from '@runonflux/aa-schnorr-multisig-sdk';
import { deriveVaultAddress } from '../../src/lib/vaultDescriptor';

const vectors = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures/vd-vectors.json'), 'utf8'),
);
const evm = vectors.vectors.find(
  (v: { name: string }) => v.name === 'eth-evm-dual-1of2',
);

describe('EVM vault address cache', () => {
  it('derives once, then answers from the cache with the same address', () => {
    const spy = jest.spyOn(
      aaSchnorrMultisig.helpers.SchnorrHelpers,
      'getAllCombinedAddrFromKeysStrict',
    );
    const expected = evm.derived[0];
    const first = deriveVaultAddress(
      evm.descriptor,
      expected.typeIndex,
      expected.addressIndex,
    );
    const callsAfterFirst = spy.mock.calls.length;
    const second = deriveVaultAddress(
      evm.descriptor,
      expected.typeIndex,
      expected.addressIndex,
    );
    expect(first.address).toBe(expected.address);
    expect(second.address).toBe(expected.address);
    expect(second.pubKeys).toEqual(first.pubKeys);
    expect(spy.mock.calls.length).toBe(callsAfterFirst);
    spy.mockRestore();
  });

  it('keeps different addresses of the same vault apart', () => {
    const [a, b] = [0, 1].map((addressIndex) =>
      deriveVaultAddress(
        evm.descriptor,
        evm.descriptor.vaultIndex,
        addressIndex,
      ),
    );
    expect(a.address).not.toBe(b.address);
  });
});
