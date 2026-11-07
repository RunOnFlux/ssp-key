import React, { useMemo, useState } from 'react';
import { MONOSPACE_FONT } from '../../lib/typography';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Image,
  StyleSheet,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';
import Authentication from '../Authentication/Authentication';
import { Globe, LogIn, OctagonAlert, Pen } from 'lucide-react-native';
import {
  classifyWkMessage,
  criticalActionCopy,
  describeCriticalScope,
  type WkMessageClassification,
} from '../../lib/wkMessage';

import { RiskBanner, SlideToApprove } from '../request';
interface WkSignRequesterInfo {
  origin: string;
  siteName?: string;
  description?: string;
  iconUrl?: string;
}

interface WkSigningRequestProps {
  activityStatus: boolean;
  message: string; // plain text message to sign
  wkIdentity: string;
  requesterInfo?: WkSignRequesterInfo;
  actionStatus: (status: boolean) => void;
}

/**
 * WK signing request (identity key /10/0).
 *
 * What is shown is derived ONLY from the classified message (lib/wkMessage),
 * never from requester-supplied labels, for everything SSP itself issues:
 *  - enterprise_login: "Sign in to SSP Enterprise at <origin from the message>"
 *  - critical / critical_legacy: a dedicated red screen naming the action, the
 *    organisation and the target identity
 *  - generic: the requester details, explicitly marked as claimed by the
 *    requesting site, with the full message shown prominently
 *  - invalid: refused — the slider is not rendered at all
 * Home only mounts this screen after the request's walletSignature verified
 * against the paired wallet's identity key; handleSignWkAction re-checks both
 * before signing.
 */
const WkSigningRequest: React.FC<WkSigningRequestProps> = ({
  activityStatus,
  message,
  requesterInfo,
  actionStatus,
}) => {
  const { t } = useTranslation(['home', 'common']);
  const { Fonts, Gutters, Layout, Colors } = useTheme();
  const [authenticationOpen, setAuthenticationOpen] = useState(false);
  const [iconError, setIconError] = useState(false);
  const classification: WkMessageClassification = useMemo(
    () => classifyWkMessage(message),
    [message],
  );

  const approve = () => {
    actionStatus(true);
  };

  const openAuthentication = () => {
    if (classification.kind === 'invalid') {
      return;
    }
    setAuthenticationOpen(true);
  };

  const reject = () => {
    actionStatus(false);
  };

  const handleAuthenticationOpen = (status: boolean) => {
    setAuthenticationOpen(false);
    if (status === true) {
      approve();
    }
  };

  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime())
      ? String(timestamp)
      : date.toLocaleString();
  };

  const fieldLabel = (label: string) => (
    <Text style={[Fonts.textTiny, { color: Colors.textGray400 }, styles.label]}>
      {label}
    </Text>
  );

  const fieldValue = (value: string, testID?: string) => (
    <Text
      testID={testID}
      style={[Fonts.textSmall, Fonts.textBold, styles.mono]}
      selectable={true}
    >
      {value}
    </Text>
  );

  const fullMessage = (prominent: boolean) => (
    <>
      <View style={[Gutters.regularTMargin, Layout.alignItemsCenter]}>
        <Text
          style={[
            Fonts.textSmall,
            Fonts.textBold,
            { color: Colors.textGray400 },
            styles.label,
          ]}
        >
          {t('home:message_to_sign')}:
        </Text>
      </View>
      <View
        style={[
          Gutters.tinyHMargin,
          styles.box,
          prominent ? styles.messageBoxProminent : styles.messageBox,
          {
            backgroundColor: Colors.inputBackground,
            borderColor: prominent ? Colors.borderStrong : Colors.textGray200,
          },
        ]}
      >
        <ScrollView
          style={styles.fill}
          showsVerticalScrollIndicator={true}
          nestedScrollEnabled={true}
        >
          <Text
            testID="wk-message"
            style={[
              prominent ? Fonts.textSmall : Fonts.textTiny,
              styles.mono,
              styles.messageText,
            ]}
            selectable={true}
          >
            {message}
          </Text>
        </ScrollView>
      </View>
    </>
  );

  const renderCritical = (
    fields: Extract<
      WkMessageClassification,
      { kind: 'critical' | 'critical_legacy' }
    >['fields'],
    origin: string | null,
  ) => {
    const { action, targetOrgId, targetWkIdentity, timestamp } = fields;
    const actionKey = criticalActionCopy(action);
    const scope = describeCriticalScope(targetOrgId, targetWkIdentity);
    const noneText = (testID: string, label: string) => (
      <Text
        testID={testID}
        style={[Fonts.textSmall, { color: Colors.textGray400 }]}
      >
        {label}
      </Text>
    );
    return (
      <>
        <OctagonAlert size={40} color={Colors.error} />
        <Text
          testID="wk-critical-title"
          style={[
            Fonts.textBold,
            Fonts.textCenter,
            Fonts.textRegular,
            Gutters.smallBMargin,
            { color: Colors.error },
          ]}
        >
          {t('home:wk_critical_title')}
        </Text>
        <View
          style={[
            Gutters.tinyHMargin,
            styles.box,
            styles.criticalBox,
            {
              backgroundColor: Colors.inputBackground,
              borderColor: Colors.error,
            },
          ]}
        >
          {fieldLabel(t('home:wk_critical_action'))}
          <Text
            testID="wk-critical-action"
            style={[Fonts.textSmall, Fonts.textBold, { color: Colors.error }]}
          >
            {actionKey
              ? t(actionKey.label)
              : t('home:wk_critical_action_unknown', { action })}
          </Text>
          {scope.kind === 'user' ? (
            <>
              <View style={Gutters.smallTMargin}>
                {fieldLabel(t('home:wk_critical_account'))}
                {noneText(
                  'wk-critical-account',
                  t('home:wk_critical_account_value'),
                )}
              </View>
              <View style={Gutters.smallTMargin}>
                {fieldLabel(t('home:wk_critical_new_email'))}
                {scope.target
                  ? fieldValue(scope.target, 'wk-critical-email')
                  : noneText(
                      'wk-critical-email',
                      t('home:wk_critical_email_none'),
                    )}
              </View>
            </>
          ) : (
            <>
              <View style={Gutters.smallTMargin}>
                {fieldLabel(t('home:wk_critical_org'))}
                {fieldValue(scope.orgId || '—', 'wk-critical-org')}
              </View>
              {scope.kind === 'vault' && (
                <View style={Gutters.smallTMargin}>
                  {fieldLabel(t('home:wk_critical_vault'))}
                  {fieldValue(scope.vaultId || '—', 'wk-critical-vault')}
                </View>
              )}
              <View style={Gutters.smallTMargin}>
                {fieldLabel(t('home:wk_critical_target'))}
                {scope.target
                  ? fieldValue(scope.target, 'wk-critical-target')
                  : noneText(
                      'wk-critical-target',
                      t('home:wk_critical_no_target'),
                    )}
              </View>
            </>
          )}
          <View style={Gutters.smallTMargin}>
            {fieldLabel(t('home:wk_critical_origin'))}
            {origin ? (
              fieldValue(origin, 'wk-critical-origin')
            ) : (
              <Text
                testID="wk-critical-origin"
                style={[Fonts.textSmall, { color: Colors.textGray400 }]}
              >
                {t('home:wk_critical_origin_legacy')}
              </Text>
            )}
          </View>
          <View style={Gutters.smallTMargin}>
            {fieldLabel(t('home:wk_requested_at'))}
            <Text style={[Fonts.textTiny]}>{formatTimestamp(timestamp)}</Text>
          </View>
        </View>
        <RiskBanner
          severity="critical"
          title={t('home:wk_critical_warning_title')}
          messages={[
            ...(actionKey ? [t(actionKey.effect)] : []),
            t('home:wk_critical_warning_msg'),
          ]}
          style={Gutters.smallTMargin}
        />
        {fullMessage(false)}
      </>
    );
  };

  const renderBody = () => {
    switch (classification.kind) {
      case 'invalid':
        return (
          <>
            <OctagonAlert size={40} color={Colors.error} />
            <Text
              testID="wk-refused-title"
              style={[
                Fonts.textBold,
                Fonts.textCenter,
                Fonts.textRegular,
                Gutters.smallBMargin,
                { color: Colors.error },
              ]}
            >
              {t('home:wk_refused_title')}
            </Text>
            <Text
              style={[
                Fonts.textSmall,
                Fonts.textCenter,
                Gutters.smallLMargin,
                Gutters.smallRMargin,
              ]}
            >
              {t('home:wk_refused_info')}
            </Text>
            {fullMessage(false)}
          </>
        );
      case 'enterprise_login':
        return (
          <>
            <LogIn size={40} color={Colors.textGray400} />
            <Text
              testID="wk-login-title"
              style={[
                Fonts.textBold,
                Fonts.textCenter,
                Fonts.textRegular,
                Gutters.smallBMargin,
              ]}
            >
              {t('home:wk_login_title')}
            </Text>
            <View
              style={[
                Gutters.tinyHMargin,
                styles.box,
                {
                  backgroundColor: Colors.inputBackground,
                  borderColor: Colors.borderStrong,
                },
              ]}
            >
              {fieldLabel(t('home:wk_login_at'))}
              {fieldValue(classification.fields.origin, 'wk-login-origin')}
              <View style={Gutters.smallTMargin}>
                {fieldLabel(t('home:wk_requested_at'))}
                <Text style={[Fonts.textTiny]}>
                  {formatTimestamp(classification.fields.timestamp)}
                </Text>
              </View>
            </View>
            <RiskBanner
              severity="info"
              title={t('home:wk_login_check_title')}
              messages={[t('home:wk_login_check_msg')]}
              style={Gutters.smallTMargin}
            />
            {fullMessage(false)}
          </>
        );
      case 'critical':
        return renderCritical(
          classification.fields,
          classification.fields.origin,
        );
      case 'critical_legacy':
        return renderCritical(classification.fields, null);
      case 'generic':
      default:
        return (
          <>
            <Pen size={40} color={Colors.textGray400} />
            <Text
              testID="wk-generic-title"
              style={[
                Fonts.textBold,
                Fonts.textCenter,
                Fonts.textRegular,
                Gutters.smallBMargin,
              ]}
            >
              {t('home:wk_signing_request')}
            </Text>
            <Text
              style={[
                Fonts.textSmall,
                Fonts.textCenter,
                Gutters.smallLMargin,
                Gutters.smallRMargin,
              ]}
            >
              {t('home:wk_signing_request_info')}
            </Text>
            {/* Message first and prominent — it is what gets signed. */}
            {fullMessage(true)}
            {requesterInfo && (
              <>
                <View style={[Gutters.regularTMargin, Layout.alignItemsCenter]}>
                  <Text
                    testID="wk-requester-claimed"
                    style={[
                      Fonts.textSmall,
                      Fonts.textBold,
                      { color: Colors.textGray400 },
                      styles.label,
                    ]}
                  >
                    {t('home:wk_requester_claimed')}:
                  </Text>
                </View>
                <View
                  style={[
                    Gutters.tinyHMargin,
                    styles.box,
                    {
                      backgroundColor: Colors.inputBackground,
                      borderColor: Colors.textGray200,
                    },
                  ]}
                >
                  {requesterInfo.siteName && (
                    <View
                      style={[Layout.row, Layout.alignItemsCenter, styles.row]}
                    >
                      {requesterInfo.iconUrl &&
                      !iconError &&
                      requesterInfo.iconUrl.startsWith('https://') &&
                      !requesterInfo.iconUrl.toLowerCase().endsWith('.svg') ? (
                        <Image
                          source={{ uri: requesterInfo.iconUrl }}
                          style={styles.icon}
                          resizeMode="contain"
                          onError={() => setIconError(true)}
                        />
                      ) : (
                        <View
                          style={[
                            styles.icon,
                            styles.iconFallback,
                            { backgroundColor: Colors.textGray200 },
                          ]}
                        >
                          <Globe size={14} color={Colors.textGray400} />
                        </View>
                      )}
                      <Text
                        style={[Fonts.textSmall, styles.fill]}
                        numberOfLines={1}
                      >
                        {requesterInfo.siteName}
                      </Text>
                    </View>
                  )}
                  {fieldLabel(t('home:origin'))}
                  <Text
                    style={[Fonts.textSmall, styles.mono]}
                    selectable={true}
                  >
                    {requesterInfo.origin}
                  </Text>
                  {requesterInfo.description && (
                    <Text style={[Fonts.textSmall, Gutters.tinyTMargin]}>
                      {requesterInfo.description}
                    </Text>
                  )}
                </View>
              </>
            )}
            <RiskBanner
              severity="high"
              title={t('home:wk_generic_warning_title')}
              messages={[t('home:wk_generic_warning_msg')]}
              style={Gutters.smallTMargin}
            />
          </>
        );
    }
  };

  const refused = classification.kind === 'invalid';

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
        {renderBody()}
      </View>

      <View
        style={[
          Layout.selfStretch,
          Layout.justifyContentEnd,
          Gutters.tinyHMargin,
        ]}
      >
        {!refused && (
          <SlideToApprove
            label={t('home:slide_to_approve')}
            accessibilityLabel={t('home:approve_request')}
            style={[Gutters.regularBMargin, Gutters.smallTMargin]}
            disabled={authenticationOpen || activityStatus}
            loading={authenticationOpen || activityStatus}
            onComplete={() => openAuthentication()}
          />
        )}
        <TouchableOpacity
          testID="wk-reject"
          accessibilityRole="button"
          disabled={authenticationOpen || activityStatus}
          onPress={() => reject()}
          hitSlop={{ top: 12, bottom: 12, left: 24, right: 24 }}
        >
          <Text
            style={[
              Fonts.textSmall,
              Fonts.textPrimary,
              Gutters.regularBMargin,
              Fonts.textCenter,
              refused ? Gutters.regularTMargin : undefined,
            ]}
          >
            {refused ? t('home:close') : t('home:reject')}
          </Text>
        </TouchableOpacity>
      </View>

      {authenticationOpen && !refused && (
        <Authentication
          actionStatus={handleAuthenticationOpen}
          type="wksigning"
          biomatricsAllowed={true}
        />
      )}
    </>
  );
};

const styles = StyleSheet.create({
  fill: { flex: 1 },
  label: { marginBottom: 4 },
  mono: { fontFamily: MONOSPACE_FONT },
  box: {
    borderRadius: 8,
    padding: 12,
    alignSelf: 'stretch',
    borderWidth: 1,
  },
  criticalBox: { borderWidth: 2 },
  messageBox: { height: 80, maxHeight: 80, padding: 10 },
  messageBoxProminent: { minHeight: 80, maxHeight: 220, padding: 10 },
  messageText: { lineHeight: 18 },
  row: { marginBottom: 8 },
  icon: { width: 24, height: 24, borderRadius: 4, marginRight: 8 },
  iconFallback: { alignItems: 'center', justifyContent: 'center' },
});

export default WkSigningRequest;
