import React from 'react';
import AddressDetails from '../../../components/AddressDetails/AddressDetails';
import SSPKeyDetails from '../../../components/SSPKeyDetails/SSKeyDetails';
import SettingsSection from '../../../components/SettingsSection/SettingsSection';
import SyncNeeded from '../../../components/SyncNeeded/SyncNeeded';
import Authentication from '../../../components/Authentication/Authentication';
import ManualInput from '../../../components/ManualInput/ManualInput';
import Receive from '../../../components/Receive/Receive';
import MenuModal from '../../../components/MenuModal/MenuModal';
import { MainScreenProps } from '../../../../@types/navigation';

type HomeNavigation = MainScreenProps<'Home'>['navigation'];

/**
 * The modal section of the Home screen: address/key details, settings,
 * sync-needed prompt, authentication gate, manual input, receive and menu
 * modals. JSX relocated verbatim from Home.tsx — state and handlers stay
 * in Home and arrive via props under their original names. Mount order is
 * unchanged from Home.tsx.
 */
const HomeModals = (props: {
  addrDetailsOpen: boolean;
  handleAddrDetailsModalAction: () => void;
  sspKeyDetailsOpen: boolean;
  handleSSPKeyModalAction: () => void;
  settingsMenuOpen: boolean;
  handleSettingsModalAction: () => void;
  navigation: HomeNavigation;
  syncNeededModalOpen: boolean;
  handleSyncNeededModalAction: (status: string) => void;
  authenticationOpen: boolean;
  handleAuthenticationOpen: (status: boolean) => void;
  manualInputModalOpen: boolean;
  handleManualInput: (inputValue: string) => void;
  receiveModalOpen: boolean;
  handleReceiveModalAction: () => void;
  isMenuModalOpen: boolean;
  handleMenuModalAction: (status: string) => void;
}) => {
  const {
    addrDetailsOpen,
    handleAddrDetailsModalAction,
    sspKeyDetailsOpen,
    handleSSPKeyModalAction,
    settingsMenuOpen,
    handleSettingsModalAction,
    navigation,
    syncNeededModalOpen,
    handleSyncNeededModalAction,
    authenticationOpen,
    handleAuthenticationOpen,
    manualInputModalOpen,
    handleManualInput,
    receiveModalOpen,
    handleReceiveModalAction,
    isMenuModalOpen,
    handleMenuModalAction,
  } = props;

  return (
    <>
      {addrDetailsOpen && (
        <AddressDetails actionStatus={handleAddrDetailsModalAction} />
      )}
      {sspKeyDetailsOpen && (
        <SSPKeyDetails actionStatus={handleSSPKeyModalAction} />
      )}
      {settingsMenuOpen && (
        <SettingsSection
          actionStatus={handleSettingsModalAction}
          navigation={navigation}
        />
      )}
      {syncNeededModalOpen && (
        <SyncNeeded actionStatus={handleSyncNeededModalAction} />
      )}
      {authenticationOpen && (
        <Authentication
          actionStatus={handleAuthenticationOpen}
          type="sensitive"
          biomatricsAllowed={true}
        />
      )}
      {manualInputModalOpen && <ManualInput actionStatus={handleManualInput} />}
      {receiveModalOpen && <Receive actionStatus={handleReceiveModalAction} />}
      {isMenuModalOpen && <MenuModal actionStatus={handleMenuModalAction} />}
    </>
  );
};

export default HomeModals;
