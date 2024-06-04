// @ts-nocheck
const BigNumber = require('bignumber.js');
const utxolib = require('@runonflux/utxo-lib');
function decodeTransactionForApproval(rawTx: string, chain: string, utxos: []) {
  try {
    const libID = 'zelcash';
    const decimals = 8;
    const network = utxolib.networks[libID];
    const txhex = rawTx;
    const txb = utxolib.TransactionBuilder.fromTransaction(
      utxolib.Transaction.fromHex(txhex, network),
      network,
    );
    console.log(JSON.stringify(txb));
    let txReceiver = 'decodingError';
    let amount = '0';
    let senderAddress = '';
    let totalInputsAmount = new BigNumber(0);
    let totalOutputsAmount = new BigNumber(0);

    if (txb.inputs[0].witnessScript && txb.inputs[0].redeemScript) {
      // p2sh-p2wsh
      const scriptPubKey = utxolib.script.scriptHash.output.encode(
        utxolib.crypto.hash160(txb.inputs[0].redeemScript),
      );
      senderAddress = utxolib.address.fromOutputScript(scriptPubKey, network);
    } else if (txb.inputs[0].witnessScript) {
      // p2wsh
      const scriptPubKey = utxolib.script.witnessScriptHash.output.encode(
        utxolib.crypto.sha256(txb.inputs[0].witnessScript),
      );
      senderAddress = utxolib.address.fromOutputScript(scriptPubKey, network);
    } else {
      // p2sh
      const scriptPubKey = utxolib.script.scriptHash.output.encode(
        utxolib.crypto.hash160(txb.inputs[0].redeemScript),
      );
      senderAddress = utxolib.address.fromOutputScript(scriptPubKey, network);
    }

    txb.tx.outs.forEach((out: any) => {
      if (out.value) {
        const address = utxolib.address.fromOutputScript(out.script, network);
        console.log(address);
        totalOutputsAmount = totalOutputsAmount.plus(new BigNumber(out.value));
        if (address !== senderAddress) {
          txReceiver = address;
          amount = new BigNumber(out.value)
            .dividedBy(new BigNumber(10 ** decimals))
            .toFixed();
        }
      }
    });
    if (txReceiver === 'decodingError') {
      // use first output as being the receiver
      const outOne = txb.tx.outs[0];
      if (outOne.value) {
        const address = utxolib.address.fromOutputScript(
          outOne.script,
          network,
        );
        console.log(address);
        txReceiver = address;
        amount = new BigNumber(outOne.value)
          .dividedBy(new BigNumber(10 ** decimals))
          .toFixed();
      }
    }

    if (utxos && utxos.length) {
      // utxos were supplied, we can calculate fee
      utxos.forEach((u) => {
        totalInputsAmount = totalInputsAmount.plus(new BigNumber(u.satoshis));
      });
    }

    const fee = totalInputsAmount
      .minus(totalOutputsAmount)
      .dividedBy(10 ** decimals)
      .toFixed();
    // calculate fee
    if (utxos && utxos.length && +fee < 0) {
      // fee is negative, something is wrong. Reject.
      throw new Error('Unexpected negative fee. Transaction Rejected.');
    }
    const txInfo = {
      sender: senderAddress,
      receiver: txReceiver,
      amount,
      fee,
    };
    return txInfo;
  } catch (error) {
    console.log(error);
    const txInfo = {
      sender: 'decodingError',
      receiver: 'decodingError',
      amount: 'decodingError',
      fee: 'decodingError',
    };
    return txInfo;
  }
}

decodeTransactionForApproval('0400008085202f8901ae4844e51404665d926d1cff0c9418edec61573ee1c46e6a79fe769c3e4dcd7e000000009300483045022100b0763c780ec2330b5606c029bb14b6b55411861945c9e3b2f35b96d3917f897502207dff8806df84c3e89e57852a6d9b1d8907fca5b9bc2500214aa4f83a68c35d720100475221028a84449ac64283d5dbf27567540ea1d057eedd3a7910518d35d3a28208c3284e2103ffc0b5218d13f80cdc45d6c92062dd00bdac8213b279dc4ca0dc44e4d7f5d0a752aefdffffff0280f0fa02000000001976a914ce9939fdd4832dd9bbdaf6c504480c312114eb7388ac20effa020000000017a914076999c239ac66ac736440f3f53bf6a561a77d898700000000000000000000000000000000000000', 'flux', []);
