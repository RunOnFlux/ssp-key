import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useTheme } from '../../hooks';
import Icon from 'react-native-vector-icons/Feather';
import {
  sortWarnings,
  detectDecodeMismatch,
  type ProposalSimulation,
  type SimWarning,
  type SimWarningCode,
  type SimWarningSeverity,
} from '../../lib/vaultSimulation';
import type { VaultDecodedTx } from '../../lib/transactions';

/**
 * RISK STRIP — compact, ADVISORY risk preview for vault signing.
 *
 * Fed by the server-computed `simulation.warnings`. It sits ABOVE the
 * authenticate/approve control so a signer must scroll past critical/high
 * warnings, but it NEVER disables the approve button (warn-and-allow; the
 * never-strand-funds invariant). The device's own VaultDecodedTx remains the
 * PRIMARY, authoritative display of what is being signed — this strip is
 * clearly labelled "Risk checks (advisory)".
 *
 * Critical/high → prominent banner. Medium/info → collapsible list.
 * SIMULATION_DECODE_MISMATCH is computed client-side by comparing the server
 * simulation to the device decode; on divergence it shows a critical banner.
 */

interface VaultRiskStripProps {
  simulation?: ProposalSimulation | null;
  /** Device's own trustless decode — authoritative source for mismatch check. */
  decodedTx?: VaultDecodedTx | null;
}

// Explicit, type-safe map from warning code → its (literal) i18n key. Using a
// switch keeps i18next's strict key typing happy (it rejects dynamic keys) and
// guarantees every SimWarningCode has a label.
function warningI18nKey(code: SimWarningCode): string {
  switch (code) {
    case 'UNLIMITED_APPROVAL':
      return 'home:vault_sim_warn_UNLIMITED_APPROVAL';
    case 'NON_ZERO_APPROVAL':
      return 'home:vault_sim_warn_NON_ZERO_APPROVAL';
    case 'APPROVAL_TO_EOA':
      return 'home:vault_sim_warn_APPROVAL_TO_EOA';
    case 'RECIPIENT_NOT_ALLOWLISTED':
      return 'home:vault_sim_warn_RECIPIENT_NOT_ALLOWLISTED';
    case 'ADDRESS_POISONING':
      return 'home:vault_sim_warn_ADDRESS_POISONING';
    case 'NEW_RECIPIENT':
      return 'home:vault_sim_warn_NEW_RECIPIENT';
    case 'UNVERIFIED_CONTRACT':
      return 'home:vault_sim_warn_UNVERIFIED_CONTRACT';
    case 'NEW_CONTRACT':
      return 'home:vault_sim_warn_NEW_CONTRACT';
    case 'VALUE_TO_CONTRACT':
      return 'home:vault_sim_warn_VALUE_TO_CONTRACT';
    case 'KNOWN_MALICIOUS':
      return 'home:vault_sim_warn_KNOWN_MALICIOUS';
    case 'SIMULATION_REVERTED':
      return 'home:vault_sim_warn_SIMULATION_REVERTED';
    case 'BALANCE_MISMATCH':
      return 'home:vault_sim_warn_BALANCE_MISMATCH';
    case 'SIMULATION_DECODE_MISMATCH':
      return 'home:vault_sim_warn_SIMULATION_DECODE_MISMATCH';
    case 'SIMULATION_UNAVAILABLE':
      return 'home:vault_sim_warn_SIMULATION_UNAVAILABLE';
    default:
      return '';
  }
}

/** Localized warning label, with the server-supplied English message as fallback. */
function warningLabel(t: TFunction<['home']>, w: SimWarning): string {
  const key = warningI18nKey(w.code);
  if (!key) return w.message;
  const translated = t(key, { defaultValue: w.message });
  return translated;
}

const VaultRiskStrip: React.FC<VaultRiskStripProps> = ({
  simulation,
  decodedTx,
}) => {
  const { t } = useTranslation(['home']);
  const { Fonts, Colors } = useTheme();
  const [expanded, setExpanded] = useState(false);

  // Client-side SIMULATION_DECODE_MISMATCH: compare server sim recipients/
  // amounts to the device's own decode. Synthesized as a critical warning so it
  // renders in the same banner pipeline as the server warnings. The React
  // Compiler handles memoization automatically — no manual useMemo needed.
  const mismatch = detectDecodeMismatch(simulation ?? undefined, decodedTx);

  const baseWarnings: SimWarning[] = simulation?.warnings
    ? [...simulation.warnings]
    : [];
  if (
    mismatch.mismatch &&
    !baseWarnings.some((w) => w.code === 'SIMULATION_DECODE_MISMATCH')
  ) {
    // Avoid duplicating a server-supplied mismatch warning.
    baseWarnings.push({
      code: 'SIMULATION_DECODE_MISMATCH',
      severity: 'critical',
      message: 'Server risk preview disagrees with the decoded transaction.',
      detail: mismatch.reason,
      provider: 'device',
    });
  }
  const allWarnings = sortWarnings(baseWarnings);

  // Nothing to show: no simulation field at all and no mismatch. Render nothing
  // — the proposal stays fully signable (graceful, absence is not an error).
  if (!simulation && !mismatch.mismatch) {
    return null;
  }

  const status = simulation?.status;
  const banners = allWarnings.filter(
    (w) => w.severity === 'critical' || w.severity === 'high',
  );
  const minor = allWarnings.filter(
    (w) => w.severity === 'medium' || w.severity === 'info',
  );

  const severityColor = (sev: SimWarningSeverity): string => {
    switch (sev) {
      case 'critical':
        return Colors.error;
      case 'high':
        return Colors.warning;
      default:
        return Colors.textGray400;
    }
  };

  const cardWidth = '90%' as const;

  return (
    <View style={{ width: cardWidth, marginBottom: 12 }}>
      {/* Advisory label */}
      <View style={styles.headerRow}>
        <Icon name="alert-triangle" size={14} color={Colors.textGray400} />
        <Text
          style={[
            Fonts.textTiny,
            Fonts.textBold,
            { color: Colors.textGray400, marginLeft: 6 },
          ]}
        >
          {t('home:vault_sim_advisory_title')}
        </Text>
      </View>

      {/* status: reverted headline (high severity) */}
      {status === 'reverted' && (
        <View
          style={[
            styles.banner,
            {
              backgroundColor: Colors.inputBackground,
              borderColor: Colors.warning,
            },
          ]}
        >
          <Text
            style={[Fonts.textTiny, Fonts.textBold, { color: Colors.warning }]}
          >
            {t('home:vault_sim_reverted_title')}
          </Text>
          <Text
            style={[
              Fonts.textTiny,
              { color: Colors.textGray400, marginTop: 2 },
            ]}
          >
            {t('home:vault_sim_reverted_desc')}
          </Text>
          {simulation?.revertReason ? (
            <Text
              style={[
                Fonts.textTiny,
                {
                  color: Colors.textGray400,
                  marginTop: 2,
                  fontStyle: 'italic',
                },
              ]}
            >
              {simulation.revertReason}
            </Text>
          ) : null}
        </View>
      )}

      {/* status: unavailable — best-effort notice (info) */}
      {status === 'unavailable' && (
        <View
          style={[
            styles.banner,
            {
              backgroundColor: Colors.inputBackground,
              borderColor: Colors.textGray200,
            },
          ]}
        >
          <Text style={[Fonts.textTiny, { color: Colors.textGray400 }]}>
            {t('home:vault_sim_unavailable')}
          </Text>
        </View>
      )}

      {/* status: pending — simulation still running */}
      {status === 'pending' && (
        <View
          style={[
            styles.banner,
            {
              backgroundColor: Colors.inputBackground,
              borderColor: Colors.textGray200,
            },
          ]}
        >
          <Text style={[Fonts.textTiny, { color: Colors.textGray400 }]}>
            {t('home:vault_sim_pending')}
          </Text>
        </View>
      )}

      {/* Critical / high warnings — prominent banners ABOVE the approve control */}
      {banners.map((w, index) => (
        <View
          key={`${w.code}-${String(index)}`}
          style={[
            styles.banner,
            {
              backgroundColor: Colors.inputBackground,
              borderColor: severityColor(w.severity),
            },
          ]}
        >
          <View style={styles.headerRow}>
            <Icon
              name={
                w.severity === 'critical' ? 'alert-octagon' : 'alert-triangle'
              }
              size={14}
              color={severityColor(w.severity)}
            />
            <Text
              style={[
                Fonts.textTiny,
                Fonts.textBold,
                {
                  color: severityColor(w.severity),
                  marginLeft: 6,
                  flexShrink: 1,
                },
              ]}
            >
              {warningLabel(t, w)}
            </Text>
          </View>
          {w.detail ? (
            <Text
              style={[
                Fonts.textTiny,
                { color: Colors.textGray400, marginTop: 4 },
              ]}
              selectable={true}
            >
              {w.detail}
            </Text>
          ) : null}
        </View>
      ))}

      {/* Medium / info warnings — collapsible list */}
      {minor.length > 0 && (
        <View
          style={[
            styles.banner,
            {
              backgroundColor: Colors.inputBackground,
              borderColor: Colors.textGray200,
            },
          ]}
        >
          <TouchableOpacity
            style={styles.headerRow}
            onPress={() => setExpanded((prev) => !prev)}
          >
            <Icon
              name={expanded ? 'chevron-down' : 'chevron-right'}
              size={14}
              color={Colors.textGray400}
            />
            <Text
              style={[
                Fonts.textTiny,
                Fonts.textBold,
                { color: Colors.textGray400, marginLeft: 6 },
              ]}
            >
              {t('home:vault_sim_more_checks', { count: minor.length })}
            </Text>
          </TouchableOpacity>
          {expanded &&
            minor.map((w, index) => (
              <View
                key={`${w.code}-${String(index)}`}
                style={{ marginTop: 6, paddingLeft: 20 }}
              >
                <Text style={[Fonts.textTiny, { color: Colors.textGray400 }]}>
                  {'•'} {warningLabel(t, w)}
                </Text>
                {w.detail ? (
                  <Text
                    style={[
                      Fonts.textTiny,
                      { color: Colors.textGray200, marginTop: 1 },
                    ]}
                    selectable={true}
                  >
                    {w.detail}
                  </Text>
                ) : null}
              </View>
            ))}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  banner: {
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    marginTop: 8,
  },
});

export default VaultRiskStrip;
