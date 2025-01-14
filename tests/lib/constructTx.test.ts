import {
  getLibId,
  fetchUtxos,
  finaliseTransaction,
  signTransaction,
  broadcastTx,
  selectPublicNonce,
  signAndBroadcastEVM,
} from '../../src/lib/constructTx';

const rawTxFlux =
  '0400008085202f89016bf2b6449710be3300c3cc4a9ad2d4db7e88cea56168c46a16278b496e3415eb0000000092000047304402204d287d270c0d35e7c65f2b0f02b2ba8ca75e04934051691445115beb729beb54022060f01fcbf92957eb17d8a221a7d062a1fe5c86114deaf69bec99b65edafb82f201475221022a316c22acf16a9108b57f48802143cc0c0ac4b8fc360a87568e1794e51558752103749c957461154dfca921d0872ba3c9ac85d98c92e4a34fdac32bd03597fbd2f252aeffffffff02608501000000000017a914c9a895ceb2368f39686f8c77f6bc8c148ae6d54e870000000000000000136a1174657374207061796d656e74206e6f746500000000f7071a000000000000000000000000';

const rawTxSepolia = {
  id: '0x8b18236447c918b3b217da857a787a7561313b730374430596eaa6f9c2d0ee16',
  opHash: '0xc195efc3bf3541c0e4b75591c0a8bf36484fef6ef6feb85f501ed1b4daa4ba68',
  userOpRequest: {
    sender: '0xd447BA08b0d395fCAd6e480d270529c932289Ce1',
    nonce: '0x14',
    initCode: '0x',
    callData:
      '0xb61d27f600000000000000000000000066324ee406ccccdddad7f510a61af22dec391606000000000000000000000000000000000000000000000000016345785d8a000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000000',
    callGasLimit: '0x6a02',
    verificationGasLimit: '0x13d5a',
    preVerificationGas: '0xfa5c',
    maxFeePerGas: '0x7309fdd1',
    maxPriorityFeePerGas: '0x59682f00',
    paymasterAndData: '0x',
    signature:
      '0xfffffffffffffffffffffffffffffff0000000000000000000000000000000007aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1c',
  },
  combinedPubKey:
    '03b0177e3dbfa2d2460721bc1f32c80576b7adfd7ab4a899c0065879ef95296acb',
  publicKeys: {
    '0x300429d8ef26b7264fab66d9368958d0e99e3f1f':
      '02e10148f9606cfc52d5a3a5d61fb3640d5f135266f32ac0b3dceff438c3f0bd52',
    '0x24c752b40767088059fc4d4be4fe4f52facbac57':
      '032f320a64727d2d23ccd6caa40af5f2700dc3265143d275beaf04194166b6756e',
  },
  publicNonces: {
    '0x300429d8ef26b7264fab66d9368958d0e99e3f1f': {
      kPublic:
        '022f8178611318387a91b287a5942278fb2f66942dfa72f2fdae5a2de4ba2a5e62',
      kTwoPublic:
        '037a0ba8f0d247907508520ba7df81a31c3f084eb2648f566c8ad902af7a798d63',
    },
    '0x24c752b40767088059fc4d4be4fe4f52facbac57': {
      kPublic:
        '03d0976461943725f33309ff56605784ad7c8d3e2b7a82c45c5df6151d9aed1149',
      kTwoPublic:
        '03d4f0e6406c080882c5574297c01ffd26aed8ca3f0cad34258592acf74d314650',
    },
  },
  signatures: {
    '0x300429d8ef26b7264fab66d9368958d0e99e3f1f': {
      finalPublicNonce:
        '037cde1f949b8c62d815da75d6082718538d0ef68b3819bdde4b7ec3afd5c26c91',
      challenge:
        '659c5592db35c0b52ec11487d92feb627d7b51d1f0a8fe1451f148726e59871d',
      signature:
        'e1f70aa45833fdd10fe3b254d9e5b173988c1c9c4e91c8b6220ad9314a39621e',
    },
  },
};

describe('ConstructTx Lib', () => {
  describe('Verifies constructTx', () => {
    test('should return getLibId data when value is flux', () => {
      const res = getLibId('flux');
      expect(res).toBe('flux');
    });

    test('should return getLibId data when value is evm', () => {
      const res = getLibId('sepolia');
      expect(res).toBe('sepolia');
    });

    test('should return getLibId data when value is blockbook', () => {
      const res = getLibId('bch');
      expect(res).toBe('bitcoincash');
    });

    test('should return fetchUtxos data when value is valid blockbook', async () => {
      const res = await fetchUtxos(
        'bitcoincash:qrq0l3x9mqy6cjzxz85q5avj2gu5wj359ygc8kqmtm',
        'bch',
      );
      expect(res[0]).not.toBeNull();
      expect(res[0]).toBeDefined();
      expect(res[0].txid).not.toBeNull();
      expect(res[0].txid).toBeDefined();
      expect(res[0].vout).not.toBeNull();
      expect(res[0].vout).toBeDefined();
      expect(res[0].scriptPubKey).not.toBeNull();
      expect(res[0].scriptPubKey).toBeDefined();
      expect(res[0].satoshis).not.toBeNull();
      expect(res[0].satoshis).toBeDefined();
      expect(res[0].confirmations).not.toBeNull();
      expect(res[0].confirmations).toBeDefined();
      expect(res[0].coinbase).toBe(false);
    });

    test('should return fetchUtxos data when value is valid flux', async () => {
      const res = await fetchUtxos(
        't3ThbWogDoAjGuS6DEnmN1GWJBRbVjSUK4T',
        'flux',
      );
      expect(res[0]).not.toBeNull();
      expect(res[0]).toBeDefined();
      expect(res[0].txid).not.toBeNull();
      expect(res[0].txid).toBeDefined();
      expect(res[0].vout).not.toBeNull();
      expect(res[0].vout).toBeDefined();
      expect(res[0].scriptPubKey).not.toBeNull();
      expect(res[0].scriptPubKey).toBeDefined();
      expect(res[0].satoshis).not.toBeNull();
      expect(res[0].satoshis).toBeDefined();
      expect(res[0].confirmations).not.toBeNull();
      expect(res[0].confirmations).toBeDefined();
      expect(res[0].coinbase).toBe(false);
    });

    test('should return finaliseTransaction data when value is valid', () => {
      const res = finaliseTransaction(rawTxFlux, 'flux');
      expect(res).toBe(
        '0400008085202f89016bf2b6449710be3300c3cc4a9ad2d4db7e88cea56168c46a16278b496e3415eb00000000910047304402204d287d270c0d35e7c65f2b0f02b2ba8ca75e04934051691445115beb729beb54022060f01fcbf92957eb17d8a221a7d062a1fe5c86114deaf69bec99b65edafb82f201475221022a316c22acf16a9108b57f48802143cc0c0ac4b8fc360a87568e1794e51558752103749c957461154dfca921d0872ba3c9ac85d98c92e4a34fdac32bd03597fbd2f252aeffffffff02608501000000000017a914c9a895ceb2368f39686f8c77f6bc8c148ae6d54e870000000000000000136a1174657374207061796d656e74206e6f746500000000f7071a000000000000000000000000',
      );
    });

    test.skip('should return signTransaction data when value is valid', () => {
      signTransaction(
        rawTxFlux,
        'flux',
        '0x29c6fbfe8f749d4d122a3a8422e63977aaf943fb3674a927fb88f1a2833a53ad',
        'test',
        'test',
        [
          {
            txid: '9649b8ddc0e69237606bea21b886696bb90d7fa2afca1f318490054e69c5af2f',
            vout: 1,
            scriptPubKey: '76a914d12bbee355284f735f8d55e809fee9134c21acf088ac',
            satoshis: '281250000',
            confirmations: 5803,
            coinbase: false,
          },
        ],
      );
    });

    test.skip('should return broadcastTx data when value is valid', async () => {
      await broadcastTx(JSON.stringify(rawTxSepolia), 'sepolia');
    });

    test.skip('should return selectPublicNonce data when value is valid', () => {
      selectPublicNonce(JSON.stringify(rawTxSepolia), [
        {
          k: '020e2cade92e0e199e6833e0081943a0e5226344b8bf17357a406a80ed762a5747',
          kTwo: '030e2cade92e0e199e6833e0081943a0e5226344b8bf17357a406a80ed762a5747',
          kPublic:
            '020e2cade92e0e199e6833e0081943a0e5226344b8bf17357a406a80ed762a5747',
          kTwoPublic:
            '030e2cade92e0e199e6833e0081943a0e5226344b8bf17357a406a80ed762a5747',
        },
      ]);
    });

    test.skip('should return signAndBroadcastEVM data when value is valid', async () => {
      await signAndBroadcastEVM(
        JSON.stringify(rawTxSepolia),
        'sepolia',
        '0x300429d8ef26b7264fab66d9368958d0e99e3f1fprivkey',
        {
          k: '020e2cade92e0e199e6833e0081943a0e5226344b8bf17357a406a80ed762a5747',
          kTwo: '030e2cade92e0e199e6833e0081943a0e5226344b8bf17357a406a80ed762a5747',
          kPublic:
            '020e2cade92e0e199e6833e0081943a0e5226344b8bf17357a406a80ed762a5747',
          kTwoPublic:
            '030e2cade92e0e199e6833e0081943a0e5226344b8bf17357a406a80ed762a5747',
        },
      );
    });
  });
});
