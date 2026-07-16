import React, { useEffect, useState, useRef } from 'react';
import { MONOSPACE_FONT } from '../../lib/typography';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import BigNumber from 'bignumber.js';
import Authentication from '../Authentication/Authentication';
import { useTheme } from '../../hooks';
import { decodeTransactionForApproval } from '../../lib/transactions';
import { decodeErc20Calldata } from '../../lib/calldataDecode';
import { getCryptoUsdRate, formatUsdAmount } from '../../lib/rates';
import { cryptos, utxo } from '../../types';

import { blockchains } from '@storage/blockchains';

import {
  RequestHeader,
  ActionCard,
  RecipientCard,
  FeeRow,
  RiskBanner,
  AdvancedSection,
  SlideToApprove,
} from '../request';

/**
 * Consumer transaction approval — rebuilt on the shared request blocks.
 *
 * Every displayed value comes from the SAME on-device decode as before
 * (decodeTransactionForApproval); this component only re-presents it.
 * Raw calldata hex is no longer primary content — it lives in Advanced.
 * Decode failures show a clear blocking error state instead of silently
 * auto-rejecting (approval is impossible; reject stays reachable).
 */
const TransactionRequest = (props: {
  rawTx: string;
  chain: keyof cryptos;
  utxos: utxo[];
  activityStatus: boolean;
  actionStatus: (status: boolean) => void;
}) => {
  const alreadyRunning = useRef(false); // as of react strict mode, useEffect is triggered twice. This is a hack to prevent that without disabling strict mode
  const { t } = useTranslation(['home', 'common']);
  const { Fonts, Gutters, Layout, Colors } = useTheme();
  const [sendingAmount, setSendingAmount] = useState('');
  const [receiverAddress, setReceiverAddress] = useState('');
  const [senderAddress, setSenderAddress] = useState('');
  const [token, setToken] = useState('');
  const [tokenSymbol, setTokenSymbol] = useState('');
  const [txData, setTxData] = useState('');
  const [fee, setFee] = useState('');
  const [usdRate, setUsdRate] = useState(0);
  const [decodeFailed, setDecodeFailed] = useState(false);
  const [authenticationOpen, setAuthenticationOpen] = useState(false);
  const blockchainConfig = blockchains[props.chain];

  const approve = () => {
    console.log('Approve');
    props.actionStatus(true);
  };
  const openAuthentication = () => {
    console.log('Open Authentication');
    setAuthenticationOpen(true);
  };
  const reject = () => {
    console.log('Reject');
    props.actionStatus(false);
  };
  const handleAuthenticationOpen = (status: boolean) => {
    console.log(status);
    console.log('authentication modal close.');
    setAuthenticationOpen(false);
    if (status === true) {
      approve();
    }
  };
  useEffect(() => {
    if (alreadyRunning.current) {
      return;
    }
    if (!props.rawTx || !props.chain) {
      return;
    }
    alreadyRunning.current = true;
    // Cancellation flag for the fire-and-forget USD rate fetch — an in-flight
    // fetch from a previous tx must never set a rate used with values from a
    // different transaction while a new transaction is displayed.
    let cancelled = false;
    console.log('Transaction Request');
    console.log(props.rawTx);
    console.log(props.chain);
    setUsdRate(0); // never show a stale fiat value on a re-used component
    setDecodeFailed(false);
    void (async function () {
      try {
        const txInfo = await decodeTransactionForApproval(
          props.rawTx,
          props.chain,
          props.utxos,
        );
        console.log(txInfo);
        setSendingAmount(txInfo.amount);
        setReceiverAddress(txInfo.receiver);
        setSenderAddress(txInfo.sender);
        setToken(txInfo.token || '');
        setTokenSymbol(txInfo.tokenSymbol);
        setTxData(txInfo.data || '');
        if (
          (props.utxos && props.utxos.length) ||
          blockchains[props.chain].chainType === 'evm' ||
          blockchains[props.chain].chainType === 'sol'
        ) {
          setFee(txInfo.fee);
        }
        // USD estimate for the chain's NATIVE asset — used for the native
        // amount and for the fee (fees are always native). Token amounts
        // never get a fiat estimate (never risk a wrong fiat value for
        // tokens on an authorization screen). Fire-and-forget: must never
        // block or fail the decode/approval path.
        if (txInfo.amount !== 'decodingError') {
          void getCryptoUsdRate(props.chain).then((rate) => {
            if (cancelled) {
              return; // effect re-ran for a new tx — this rate is stale
            }
            if (rate > 0) {
              setUsdRate(rate);
            }
          });
        }
        if (
          txInfo.amount === 'decodingError' ||
          txInfo.receiver === 'decodingError' ||
          txInfo.sender === 'decodingError'
        ) {
          // Fail closed with a VISIBLE error state — approval is impossible,
          // reject stays reachable. Previously this silently auto-rejected.
          displayMessage('error', t('home:err_tx_decode'));
          setDecodeFailed(true);
        }
      } catch (error) {
        console.log(error);
        displayMessage('error', t('home:err_tx_decode'));
        setDecodeFailed(true);
      } finally {
        alreadyRunning.current = false;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.rawTx, props.chain]);
  const displayMessage = (type: string, content: string) => {
    Toast.show({
      type,
      text1: content,
    });
  };

  // ---- Presentation-only derivations (no re-deriving of signed data) ----
  const displaySymbol = token ? tokenSymbol : blockchainConfig.symbol;

  // Human decode of leftover raw calldata (unknown-token contract executions).
  // Display-only: approval still signs the exact original payload.
  const humanCalldata =
    token && txData && txData !== '0x'
      ? decodeErc20Calldata(txData, token, props.chain)
      : null;

  // Native amount fiat (never for tokens); fee fiat (fees are always native).
  const amountUsd = (() => {
    if (token || !sendingAmount || decodeFailed || usdRate <= 0) {
      return '';
    }
    const usd = new BigNumber(sendingAmount).multipliedBy(usdRate);
    if (usd.isFinite() && usd.isGreaterThan(0)) {
      return formatUsdAmount(usd.toNumber());
    }
    return '';
  })();
  const feeUsd = (() => {
    if (!fee || decodeFailed || usdRate <= 0) {
      return '';
    }
    const usd = new BigNumber(fee).multipliedBy(usdRate);
    if (usd.isFinite() && usd.isGreaterThan(0)) {
      return formatUsdAmount(usd.toNumber());
    }
    return '';
  })();

  // Plain-language action + recipient presentation
  let actionText = t('home:action_send_amount', {
    amount: sendingAmount,
    symbol: displaySymbol,
  });
  let recipientLabel = t('home:to_recipient');
  let recipientAddress = receiverAddress;
  if (humanCalldata) {
    const known = humanCalldata.amount && humanCalldata.tokenSymbol;
    if (humanCalldata.kind === 'transfer') {
      actionText = known
        ? t('home:action_send_amount', {
            amount: humanCalldata.amount,
            symbol: humanCalldata.tokenSymbol,
          })
        : t('home:action_send_raw_units', { amount: humanCalldata.amountRaw });
    } else if (humanCalldata.kind === 'approve') {
      actionText = humanCalldata.unlimited
        ? t('home:action_approve_unlimited')
        : known
          ? t('home:action_approve_spend', {
              amount: humanCalldata.amount,
              symbol: humanCalldata.tokenSymbol,
            })
          : t('home:action_approve_spend_raw', {
              amount: humanCalldata.amountRaw,
            });
      recipientLabel = t('home:spender');
    } else {
      actionText = known
        ? t('home:action_transfer_from', {
            amount: humanCalldata.amount,
            symbol: humanCalldata.tokenSymbol,
          })
        : t('home:action_transfer_from_raw', {
            amount: humanCalldata.amountRaw,
          });
    }
    recipientAddress = humanCalldata.counterparty;
  } else if (token && txData && txData !== '0x') {
    // Unrecognized contract execution — generic action, raw hex in Advanced.
    actionText = t('home:action_contract_interaction');
  }

  const hasAdvancedContent =
    !!senderAddress || (!!txData && txData !== '0x') || !!token;

  return (
    <>
      <ScrollView
        style={[Layout.fill, Layout.fullWidth]}
        contentContainerStyle={[
          Layout.alignItemsCenter,
          { paddingTop: 20, paddingBottom: 20 },
        ]}
        showsVerticalScrollIndicator={true}
      >
        <RequestHeader
          title={t('home:transaction_request')}
          identity={senderAddress || undefined}
          chain={props.chain}
        />
        {decodeFailed ? (
          <RiskBanner
            severity="critical"
            title={t('home:tx_decode_failed_title')}
            messages={[t('home:tx_decode_failed_desc')]}
          />
        ) : (
          <>
            {humanCalldata?.kind === 'approve' && humanCalldata.unlimited ? (
              <RiskBanner
                severity="high"
                title={t('home:vault_sim_warn_UNLIMITED_APPROVAL')}
              />
            ) : null}
            {!humanCalldata && token && txData && txData !== '0x' ? (
              <RiskBanner
                severity="info"
                title={t('home:risk_unreadable_contract_call')}
              />
            ) : null}
            <ActionCard
              action={actionText}
              fiat={
                amountUsd !== ''
                  ? t('home:approx_usd', { usd: amountUsd })
                  : undefined
              }
              decodedOnDevice={true}
            />
            {recipientAddress ? (
              <RecipientCard
                label={recipientLabel}
                address={recipientAddress}
              />
            ) : null}
            {fee ? (
              <FeeRow
                label={t('home:network_fee')}
                fee={fee}
                symbol={blockchainConfig.symbol}
                fiat={
                  feeUsd !== ''
                    ? t('home:approx_usd', { usd: feeUsd })
                    : undefined
                }
              />
            ) : null}
            {hasAdvancedContent ? (
              <AdvancedSection>
                {senderAddress ? (
                  <View style={styles.advancedBlock}>
                    <Text
                      style={[
                        Fonts.textTinyTiny,
                        { color: Colors.textGray400 },
                      ]}
                    >
                      {t('home:from_sender')}
                    </Text>
                    <Text
                      style={[Fonts.textTinyTiny, styles.mono]}
                      selectable={true}
                    >
                      {senderAddress}
                    </Text>
                  </View>
                ) : null}
                {token ? (
                  <View style={styles.advancedBlock}>
                    <Text
                      style={[
                        Fonts.textTinyTiny,
                        { color: Colors.textGray400 },
                      ]}
                    >
                      {t('home:token_contract')}
                    </Text>
                    <Text
                      style={[Fonts.textTinyTiny, styles.mono]}
                      selectable={true}
                    >
                      {token}
                    </Text>
                  </View>
                ) : null}
                {txData && txData !== '0x' ? (
                  <View style={styles.advancedBlock}>
                    <Text
                      style={[
                        Fonts.textTinyTiny,
                        { color: Colors.textGray400 },
                      ]}
                    >
                      {t('home:tx_data')}
                    </Text>
                    <View
                      style={[
                        styles.rawDataBox,
                        {
                          backgroundColor: Colors.inputBackground,
                          borderColor: Colors.border,
                        },
                      ]}
                    >
                      <ScrollView
                        style={styles.rawDataScroll}
                        showsVerticalScrollIndicator={true}
                        nestedScrollEnabled={true}
                      >
                        <Text
                          style={[
                            Fonts.textTinyTiny,
                            styles.mono,
                            styles.rawDataText,
                            { color: Colors.textGray800 },
                          ]}
                          selectable={true}
                        >
                          {txData}
                        </Text>
                      </ScrollView>
                    </View>
                  </View>
                ) : null}
              </AdvancedSection>
            ) : null}
          </>
        )}
      </ScrollView>
      <View style={[Layout.justifyContentEnd]}>
        {!decodeFailed && (
          <SlideToApprove
            label={t('home:slide_to_approve')}
            accessibilityLabel={t('home:a11y_approve_send', {
              amount: sendingAmount,
              symbol: displaySymbol,
              recipient: recipientAddress,
            })}
            style={[Gutters.regularBMargin, Gutters.smallTMargin]}
            disabled={authenticationOpen || props.activityStatus}
            loading={authenticationOpen || props.activityStatus}
            onComplete={() => openAuthentication()}
          />
        )}
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={t('home:a11y_reject')}
          disabled={authenticationOpen || props.activityStatus}
          onPress={() => reject()}
          hitSlop={{ top: 12, bottom: 12, left: 24, right: 24 }}
        >
          <Text
            style={[
              Fonts.textSmall,
              Fonts.textPrimary,
              Gutters.regularBMargin,
              Fonts.textCenter,
            ]}
          >
            {t('home:reject')}
          </Text>
        </TouchableOpacity>
      </View>
      {authenticationOpen && (
        <Authentication
          actionStatus={handleAuthenticationOpen}
          type="tx"
          biomatricsAllowed={true}
        />
      )}
    </>
  );
};

const styles = StyleSheet.create({
  mono: {
    fontFamily: MONOSPACE_FONT,
  },
  advancedBlock: {
    marginBottom: 8,
  },
  rawDataBox: {
    borderRadius: 8,
    padding: 10,
    marginTop: 4,
    borderWidth: 1,
    maxHeight: 100,
  },
  rawDataScroll: {
    flex: 1,
  },
  rawDataText: {
    lineHeight: 16,
  },
});

export default TransactionRequest;
