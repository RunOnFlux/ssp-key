import React, { useEffect, useState, useRef } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import Authentication from '../Authentication/Authentication';
import { useTheme } from '../../hooks';
import { decodeTransactionForApproval } from '../../lib/transactions';
import { cryptos } from '../../types';

import { blockchains } from '@storage/blockchains';

const TransactionRequest = (props: {
  rawTx: string;
  chain: keyof cryptos;
  activityStatus: boolean;
  actionStatus: (status: boolean) => void;
}) => {
  const alreadyRunning = useRef(false); // as of react strict mode, useEffect is triggered twice. This is a hack to prevent that without disabling strict mode
  const { t } = useTranslation(['home', 'common']);
  const { Fonts, Gutters, Layout, Colors, Common } = useTheme();
  const [sendingAmount, setSendingAmount] = useState('');
  const [receiverAddress, setReceiverAddress] = useState('');
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
    alreadyRunning.current = true;
    if (!props.rawTx || !props.chain) {
      return;
    }
    console.log('Transaction Request');
    console.log(props.rawTx);
    console.log(props.chain);
    const txInfo = decodeTransactionForApproval(props.rawTx, props.chain);
    console.log(txInfo);
    setSendingAmount(txInfo.amount);
    setReceiverAddress(txInfo.receiver);
    if (
      txInfo.amount === 'decodingError' ||
      txInfo.receiver === 'decodingError'
    ) {
      displayMessage('error', t('home:err_tx_decode'));
      setTimeout(() => {
        reject();
      }, 500);
    }
    alreadyRunning.current = false;
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
        <Text style={[Fonts.textBold, Fonts.textRegular, Gutters.smallMargin]}>
          {t('home:transaction_request')}
        </Text>
        <Text style={[Fonts.textSmall, Fonts.textCenter]}>
          {t('home:sending_request', {
            amount: sendingAmount,
            address: receiverAddress,
            symbol: blockchainConfig.symbol,
          })}
        </Text>
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
        <Authentication actionStatus={handleAuthenticationOpen} type="tx" />
      )}
    </>
  );
};

export default TransactionRequest;
