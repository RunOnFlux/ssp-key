"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var bignumber_js_1 = require("bignumber.js");
var utxo_lib_1 = require("@runonflux/utxo-lib");
function decodeTransactionForApproval(rawTx, chain, utxos) {
    try {
        var libID = 'zelcash';
        var decimals_1 = 8;
        var network_1 = utxo_lib_1.default.networks[libID];
        var txhex = rawTx;
        var txb = utxo_lib_1.default.TransactionBuilder.fromTransaction(utxo_lib_1.default.Transaction.fromHex(txhex, network_1), network_1);
        console.log(JSON.stringify(txb));
        var txReceiver_1 = 'decodingError';
        var amount_1 = '0';
        var senderAddress_1 = '';
        var totalInputsAmount_1 = new bignumber_js_1.default(0);
        var totalOutputsAmount_1 = new bignumber_js_1.default(0);
        if (txb.inputs[0].witnessScript && txb.inputs[0].redeemScript) {
            // p2sh-p2wsh
            var scriptPubKey = utxo_lib_1.default.script.scriptHash.output.encode(utxo_lib_1.default.crypto.hash160(txb.inputs[0].redeemScript));
            senderAddress_1 = utxo_lib_1.default.address.fromOutputScript(scriptPubKey, network_1);
        }
        else if (txb.inputs[0].witnessScript) {
            // p2wsh
            var scriptPubKey = utxo_lib_1.default.script.witnessScriptHash.output.encode(utxo_lib_1.default.crypto.sha256(txb.inputs[0].witnessScript));
            senderAddress_1 = utxo_lib_1.default.address.fromOutputScript(scriptPubKey, network_1);
        }
        else {
            // p2sh
            var scriptPubKey = utxo_lib_1.default.script.scriptHash.output.encode(utxo_lib_1.default.crypto.hash160(txb.inputs[0].redeemScript));
            senderAddress_1 = utxo_lib_1.default.address.fromOutputScript(scriptPubKey, network_1);
        }
        txb.tx.outs.forEach(function (out) {
            if (out.value) {
                var address = utxo_lib_1.default.address.fromOutputScript(out.script, network_1);
                console.log(address);
                totalOutputsAmount_1 = totalOutputsAmount_1.plus(new bignumber_js_1.default(out.value));
                if (address !== senderAddress_1) {
                    txReceiver_1 = address;
                    amount_1 = new bignumber_js_1.default(out.value)
                        .dividedBy(new bignumber_js_1.default(Math.pow(10, decimals_1)))
                        .toFixed();
                }
            }
        });
        if (txReceiver_1 === 'decodingError') {
            // use first output as being the receiver
            var outOne = txb.tx.outs[0];
            if (outOne.value) {
                var address = utxo_lib_1.default.address.fromOutputScript(outOne.script, network_1);
                console.log(address);
                txReceiver_1 = address;
                amount_1 = new bignumber_js_1.default(outOne.value)
                    .dividedBy(new bignumber_js_1.default(Math.pow(10, decimals_1)))
                    .toFixed();
            }
        }
        if (utxos && utxos.length) {
            // utxos were supplied, we can calculate fee
            utxos.forEach(function (u) {
                totalInputsAmount_1 = totalInputsAmount_1.plus(new bignumber_js_1.default(u.satoshis));
            });
        }
        var fee = totalInputsAmount_1
            .minus(totalOutputsAmount_1)
            .dividedBy(Math.pow(10, decimals_1))
            .toFixed();
        // calculate fee
        if (+fee < 0) {
            // fee is negative, something is wrong. Reject.
            throw new Error('Unexpected negative fee. Transaction Rejected.');
        }
        var txInfo = {
            sender: senderAddress_1,
            receiver: txReceiver_1,
            amount: amount_1,
            fee: fee,
        };
        return txInfo;
    }
    catch (error) {
        console.log(error);
        var txInfo = {
            sender: 'decodingError',
            receiver: 'decodingError',
            amount: 'decodingError',
            fee: 'decodingError',
        };
        return txInfo;
    }
}
decodeTransactionForApproval('abc', 'flux', []);
