import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import Authentication from '../Authentication/Authentication';
import { useTheme } from '../../hooks';
import { decodeTransactionForApproval } from '../../lib/transactions';
import { cryptos, utxo } from '../../types';

import { blockchains } from '@storage/blockchains';

const TransactionRequest = (props: {
  rawTx: string;
  chain: keyof cryptos;
  utxos: utxo[];
  activityStatus: boolean;
  actionStatus: (status: boolean) => void;
}) => {
  const alreadyRunning = useRef(false); // as of react strict mode, useEffect is triggered twice. This is a hack to prevent that without disabling strict mode
  const { t } = useTranslation(['home', 'common']);
  const { Fonts, Gutters, Layout, Colors, Common } = useTheme();
  const [sendingAmount, setSendingAmount] = useState('');
  const [receiverAddress, setReceiverAddress] = useState('');
  const [senderAddress, setSenderAddress] = useState('');
  const [token, setToken] = useState('');
  const [tokenSymbol, setTokenSymbol] = useState('');
  const [txData, setTxData] = useState('');
  const [fee, setFee] = useState('');
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
    console.log('Transaction Request');
    console.log(props.rawTx);
    console.log(props.chain);
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
          blockchains[props.chain].chainType === 'evm'
        ) {
          setFee(txInfo.fee);
        }
        console.log(fee);
        if (
          txInfo.amount === 'decodingError' ||
          txInfo.receiver === 'decodingError' ||
          txInfo.sender === 'decodingError'
        ) {
          displayMessage('error', t('home:err_tx_decode'));
          setTimeout(() => {
            reject();
          }, 500);
        }
      } catch (error) {
        console.log(error);
        displayMessage('error', t('home:err_tx_decode'));
        setTimeout(() => {
          reject();
        }, 500);
      } finally {
        alreadyRunning.current = false;
      }
    })();
  }, [props.rawTx, props.chain]);
  const displayMessage = (type: string, content: string) => {
    Toast.show({
      type,
      text1: content,
    });
  };

  return (
    <>
      <View
        style={[
          Layout.fill,
          Layout.relative,
          Layout.fullWidth,
          Layout.justifyContentCenter,
          Layout.alignItemsCenter,
        ]}
      >
        <Icon name="send" size={60} color={Colors.textGray400} />
        <Text
          style={[
            Fonts.textBold,
            Fonts.textRegular,
            Gutters.smallMargin,
            Gutters.regularBMargin,
          ]}
        >
          {t('home:transaction_request')}
        </Text>
        <Text>
          <Text style={[Fonts.textSmall, Fonts.textCenter]}>
            {t('home:sending')}
          </Text>
          <Text style={[Fonts.textSmall, Fonts.textBold, Fonts.textCenter]}>
            {' ' +
              sendingAmount +
              ' ' +
              (token ? tokenSymbol : blockchainConfig.symbol) +
              ' '}
          </Text>
          <Text style={[Fonts.textSmall, Fonts.textCenter]}>
            {t('home:to')}
          </Text>
        </Text>
        <Text style={[Fonts.textTiny, Fonts.textBold, Fonts.textCenter]}>
          {receiverAddress}
        </Text>
        {txData && txData !== '0x' && (
          <>
            <Text
              style={[Fonts.textSmall, Fonts.textCenter, Gutters.smallTMargin]}
            >
              {t('home:tx_data')}
            </Text>
            <View
              style={[
                {
                  backgroundColor: Colors.inputBackground,
                  borderRadius: 8,
                  padding: 10,
                  marginHorizontal: 20,
                  marginTop: 8,
                  borderWidth: 1,
                  borderColor: Colors.textGray200,
                  maxHeight: 100,
                },
              ]}
            >
              <ScrollView
                style={{ flex: 1 }}
                showsVerticalScrollIndicator={true}
                nestedScrollEnabled={true}
              >
                <Text
                  style={[
                    Fonts.textTiny,
                    {
                      fontFamily: 'monospace',
                      lineHeight: 16,
                      color: Colors.textGray800,
                    },
                  ]}
                  selectable={true}
                >
                  {txData}
                </Text>
              </ScrollView>
            </View>
          </>
        )}
        <Text
          style={[Fonts.textTinyTiny, Fonts.textCenter, Gutters.smallTMargin]}
        >
          {t('home:from')}
        </Text>
        <Text style={[Fonts.textTinyTiny, Fonts.textCenter]}>
          {senderAddress}
        </Text>
        {fee && (
          <Text style={[Fonts.textTinyTiny, Fonts.textCenter]}>
            {t('home:blockchain_fee', { fee, symbol: blockchainConfig.symbol })}
          </Text>
        )}
      </View>
      <View style={[Layout.justifyContentEnd]}>
        <TouchableOpacity
          style={[
            Common.button.rounded,
            Common.button.bluePrimary,
            Gutters.regularBMargin,
            Gutters.smallTMargin,
          ]}
          disabled={authenticationOpen || props.activityStatus}
          onPressIn={() => openAuthentication()}
        >
          {(authenticationOpen || props.activityStatus) && (
            <ActivityIndicator
              size={'large'}
              style={[{ position: 'absolute' }]}
            />
          )}
          <Text style={[Fonts.textRegular, Fonts.textWhite]}>
            {t('home:approve_transaction')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          disabled={authenticationOpen || props.activityStatus}
          onPressIn={() => reject()}
        >
          <Text
            style={[
              Fonts.textSmall,
              Fonts.textBluePrimary,
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

export default TransactionRequest;
