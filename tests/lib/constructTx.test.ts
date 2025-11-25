import {
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
    }, 15000);

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

    test('should return signTransaction data when value is valid', () => {
      // Pre-computed test data derived from mnemonic:
      // 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
      // Using BIP48 derivation for Flux (coin 19167), accounts 0 and 1, p2sh script type
      // Path: m/48'/19167'/0'/0'/0/0 and m/48'/19167'/1'/0'/0/0

      // Private key (WIF) for first keypair
      const privateKeyWIF =
        'L4Y1DTXtz3EPUv4VGTj3zmyfNbMo9w44zS3iMR2mJSjHPF4cZZAf';

      // 2-of-2 multisig redeem script from sorted pubkeys:
      // 03246fe832ca2c161020db8fedf91a70540d3b6554bc105eb30f7fb67ce83867ca
      // 037558d40625e76a85afc55040fdc4c13ee24b6dad4b2dddd7caf1275220a67493
      const redeemScriptHex =
        '522103246fe832ca2c161020db8fedf91a70540d3b6554bc105eb30f7fb67ce83867ca21037558d40625e76a85afc55040fdc4c13ee24b6dad4b2dddd7caf1275220a6749352ae';

      // P2SH scriptPubKey derived from redeem script
      const scriptPubKeyHex = 'a914eac01ecfa8d06a35114014d041710c6b7024ff3787';

      // Unsigned transaction hex (spending from P2SH address t3fxsCXJHeGmaDP7Xu7UbjXUM7opop9Mf4K)
      const unsignedTxHex =
        '0400008085202f8901aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0000000000ffffffff0150c300000000000017a914eac01ecfa8d06a35114014d041710c6b7024ff378700000000000000000000000000000000000000';

      // UTXO txid matching the input
      const fakeTxId =
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

      // Sign the transaction
      const signedTx = signTransaction(
        unsignedTxHex,
        'flux',
        privateKeyWIF,
        redeemScriptHex,
        '', // no witness script for p2sh
        [
          {
            txid: fakeTxId,
            vout: 0,
            scriptPubKey: scriptPubKeyHex,
            satoshis: '100000',
            confirmations: 100,
            coinbase: false,
          },
        ],
      );

      expect(typeof signedTx).toBe('string');
      expect(signedTx.length).toBeGreaterThan(unsignedTxHex.length);
      expect(signedTx).not.toBe(unsignedTxHex);
    });

    test('should return selectPublicNonce data when value is valid', () => {
      // Use nonces that match those in rawTxSepolia.publicNonces
      const res = selectPublicNonce(JSON.stringify(rawTxSepolia), [
        {
          k: 'someprivatek',
          kTwo: 'someprivatektwo',
          kPublic:
            '022f8178611318387a91b287a5942278fb2f66942dfa72f2fdae5a2de4ba2a5e62',
          kTwoPublic:
            '037a0ba8f0d247907508520ba7df81a31c3f084eb2648f566c8ad902af7a798d63',
        },
      ]);
      expect(res).toHaveProperty('k');
      expect(res).toHaveProperty('kTwo');
      expect(res).toHaveProperty('kPublic');
      expect(res).toHaveProperty('kTwoPublic');
      expect(res.kPublic).toBe(
        '022f8178611318387a91b287a5942278fb2f66942dfa72f2fdae5a2de4ba2a5e62',
      );
    });

    // Skipped: broadcastTx makes real network requests and would broadcast actual transactions
    test.skip('should return broadcastTx data when value is valid', async () => {
      await broadcastTx(JSON.stringify(rawTxSepolia), 'sepolia');
    });

    // Skipped: signAndBroadcastEVM makes real network requests and would broadcast actual transactions
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
