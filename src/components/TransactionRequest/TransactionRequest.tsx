import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';
import { decodeTransactionForApproval } from '../../lib/transactions';

import { useAppSelector } from '../../hooks';

const TransactionRequest = (props: {
  rawTx: string;
  actionStatus: (status: boolean) => void;
}) => {
  const { address } = useAppSelector((state) => state.flux);
  const { t } = useTranslation(['home', 'common']);
  const { Fonts, Gutters, Layout, Colors, Common } = useTheme();
  const [sendingAmount, setSendingAmount] = useState('');
  const [receiverAddress, setReceiverAddress] = useState('');

  const approve = () => {
    console.log('Approve');
    props.actionStatus(true);
  };
  const reject = () => {
    console.log('Reject');
    props.actionStatus(false);
  };
  useEffect(() => {
    const txInfo = decodeTransactionForApproval(props.rawTx, address);
    setSendingAmount(txInfo.amount);
    setReceiverAddress(txInfo.receiver);
    console.log(txInfo);
  });

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
          Sending {sendingAmount} FLUX to {receiverAddress}
        </Text>
      </View>
      <View>
        <TouchableOpacity
          style={[
            Common.button.outlineRounded,
            Common.button.secondaryButton,
            Layout.fullWidth,
            Gutters.regularBMargin,
          ]}
          onPress={() => approve()}
        >
          <Text
            style={[
              Fonts.textSmall,
              Fonts.textBluePrimary,
              Gutters.regularHPadding,
            ]}
          >
            {t('home:approve_transaction')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => reject()}>
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
    </>
  );
};

export default TransactionRequest;
