import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';
import { MONOSPACE_FONT } from '../../lib/typography';
import type { TronCallView, TronOpView } from '../../lib/tron';
import { Card } from '../ui';
import RiskBanner from './RiskBanner';

const EDGE = 6;

/**
 * A full TRON address with its MIDDLE highlighted (TRON_SSP_CONTRACT.md §5.8):
 * address-poisoning lookalikes copy the first and last characters, so the
 * characters in between are the ones to compare. Never truncated.
 */
export const TronAddressText = ({ address }: { address: string }) => {
  const { Colors, Fonts } = useTheme();
  const start = address.slice(0, EDGE);
  const middle = address.slice(EDGE, Math.max(EDGE, address.length - EDGE));
  const end = address.length > EDGE ? address.slice(-EDGE) : '';
  return (
    <Text style={[Fonts.textTiny, styles.mono]} selectable={true}>
      <Text style={{ color: Colors.textGray400 }}>{start}</Text>
      <Text
        style={[
          Fonts.textBold,
          {
            color: Colors.textGray800,
            backgroundColor: Colors.circleButtonBackground,
          },
        ]}
      >
        {middle}
      </Text>
      <Text style={{ color: Colors.textGray400 }}>{end}</Text>
    </Text>
  );
};

function callTitle(
  c: TronCallView,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  switch (c.kind) {
    case 'trxTransfer':
    case 'trc20Transfer':
    case 'trc10Transfer':
      return t('home:tron_call_send');
    case 'approve':
      return t('home:tron_call_approve');
    case 'selfCall':
      return t('home:tron_call_self', { action: c.action ?? '' });
    default:
      return t('home:tron_call_unknown');
  }
}

function callAmount(
  c: TronCallView,
  t: ReturnType<typeof useTranslation>['t'],
): string | null {
  if (c.kind === 'selfCall') return null;
  if (c.kind === 'approve' && c.unlimited) return t('home:tron_unlimited');
  if (c.kind === 'trc10Transfer') {
    return t('home:tron_amount_trc10', {
      amount: c.amountBaseUnits,
      id: c.token ?? '',
    });
  }
  if (c.symbol === null) {
    return t('home:tron_amount_unknown_token', { amount: c.amountBaseUnits });
  }
  return `${c.amount} ${c.symbol}`;
}

/**
 * Every call of a decoded TRON Op, its network fee, deadline and (self-pay)
 * the paying account — the values come ONLY from the on-device
 * decodeOpForDisplay result (lib/tron.ts), never from relay text.
 */
const TronOpDetails = ({ view }: { view: TronOpView }) => {
  const { t } = useTranslation(['home']);
  const { Colors, Fonts } = useTheme();
  const label = [Fonts.textTinyTiny, { color: Colors.textGray400 }];
  const warnings = [...new Set(view.warnings)];
  return (
    <>
      {warnings.length > 0 ? (
        <RiskBanner
          severity="high"
          title={t('home:tron_warnings_title')}
          messages={warnings.map((w) =>
            t(`home:tron_warning_${w}`, { defaultValue: w }),
          )}
        />
      ) : null}
      {view.selfPay &&
      view.selfPayAccount &&
      !view.selfPayAccount.sufficient ? (
        <RiskBanner
          severity="critical"
          title={t('home:tron_self_pay_fund_title')}
          messages={[
            t('home:tron_self_pay_fund_desc', {
              minimum: view.selfPayAccount.minimum,
              address: view.selfPayAccount.address,
            }),
          ]}
        />
      ) : null}
      {view.calls.map((c) => {
        const amount = callAmount(c, t);
        return (
          <Card key={c.index} style={styles.card}>
            <Text style={[Fonts.textTiny, Fonts.textBold, styles.row]}>
              {callTitle(c, t)}
              {amount ? `: ${amount}` : ''}
            </Text>
            <Text style={label}>
              {c.kind === 'approve'
                ? t('home:spender')
                : c.kind === 'unknown' || c.kind === 'selfCall'
                  ? t('home:tron_contract')
                  : t('home:to_recipient')}
            </Text>
            <TronAddressText address={c.to} />
            {c.token && c.kind !== 'trc10Transfer' ? (
              <>
                <Text style={[label, styles.gap]}>
                  {t('home:tron_token_contract')}
                </Text>
                <TronAddressText address={c.token} />
              </>
            ) : null}
            {c.data ? (
              <>
                <Text style={[label, styles.gap]}>
                  {t('home:tron_calldata')}
                </Text>
                <Text
                  style={[Fonts.textTinyTiny, styles.mono]}
                  selectable={true}
                >
                  {c.data}
                </Text>
              </>
            ) : null}
          </Card>
        );
      })}
      <Card style={styles.card}>
        {view.fee.kind === 'none' ? (
          <>
            <Text style={[Fonts.textTiny, Fonts.textBold]}>
              {t('home:tron_fee_self_pay')}
            </Text>
            {view.selfPayAccount ? (
              <>
                <Text style={[label, styles.gap]}>
                  {t('home:tron_self_pay_account')}
                </Text>
                <TronAddressText address={view.selfPayAccount.address} />
                <Text style={[Fonts.textTinyTiny, styles.gap]}>
                  {view.selfPayAccount.balance === null
                    ? t('home:tron_self_pay_balance_unknown')
                    : t('home:tron_self_pay_balance', {
                        balance: view.selfPayAccount.balance,
                        minimum: view.selfPayAccount.minimum,
                      })}
                </Text>
              </>
            ) : null}
          </>
        ) : (
          <>
            <View style={styles.feeRow}>
              <Text style={[Fonts.textTiny, { color: Colors.textGray400 }]}>
                {t('home:tron_fee_sponsored')}
              </Text>
              <Text style={[Fonts.textTiny, Fonts.textBold, styles.tabular]}>
                {view.fee.symbol === null
                  ? t('home:tron_amount_unknown_token', {
                      amount: view.fee.amountBaseUnits,
                    })
                  : `${view.fee.amount} ${view.fee.symbol}`}
              </Text>
            </View>
            <Text style={[label, styles.gap]}>
              {t('home:tron_fee_sponsored_desc')}
            </Text>
          </>
        )}
        <View style={[styles.feeRow, styles.gap]}>
          <Text style={label}>{t('home:tron_deadline')}</Text>
          <Text style={[Fonts.textTinyTiny, styles.tabular]}>
            {new Date(view.deadline * 1000).toLocaleString()}
          </Text>
        </View>
        <View style={styles.feeRow}>
          <Text style={label}>{t('home:tron_nonce')}</Text>
          <Text style={[Fonts.textTinyTiny, styles.tabular]}>{view.nonce}</Text>
        </View>
      </Card>
    </>
  );
};

const styles = StyleSheet.create({
  card: {
    // Screen owns the side gutter — see ActionCard.
    alignSelf: 'stretch',
    marginBottom: 12,
  },
  row: {
    marginBottom: 6,
  },
  gap: {
    marginTop: 6,
  },
  feeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  mono: {
    fontFamily: MONOSPACE_FONT,
  },
  tabular: {
    fontVariant: ['tabular-nums'],
  },
});

export default TronOpDetails;
