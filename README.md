# SSP Key

**Secure. Simple. Powerful.**

---

## Overview


SSP Key is your **two-factor authentication (2FA)** solution for the  **[SSP Wallet](https://sspwallet.io)**. It securely holds the **secondary private key** required to construct **2-of-2 multisignature addresses** and sign transactions. With its own independent seed phrase, SSP Key operates on true blockchain protocol standards, providing fully enforced **multisignature, multi-asset accounts**.  

This **powerful** tool brings the **simplicity and security of multisignature technology** to average users, making it easier than ever to manage multisignature addresses across multiple assets. SSP Key empowers users with the highest level of protection while maintaining a user-friendly interface, ensuring anyone can benefit from robust, blockchain-based security without complexity.  


### How SSP Key and SSP Wallet Work Together

SSP Key is an essential part of the **SSP Wallet ecosystem**, enabling a **2-of-2 multisignature system** for unmatched security:
- **SSP Wallet** manages one private key.  
- **SSP Key** (on your mobile device) holds the second private key.  
Both keys are required to authorize transactions, ensuring that your funds remain secure even if one device is compromised.

---

## Key Features

### **Advanced Encryption**
- **Secure Storage**: User passwords and sensitive data are stored with `react-native-encrypted-storage`, leveraging MMKV with encryption powered by CryptoJS.
- **Randomized Security**: Salts and initialization vectors (IVs) are randomly generated to enhance encryption robustness.
- **Performance Focused**: Avoids underperforming libraries like Cryptr, ensuring optimal functionality in React Native environments.

### **Unique Device Identification**
- Passwords combine **`DeviceInfo.getUniqueID()`** with user input (password or PIN), ensuring device-specific encryption.
- For details, see [Device Information for React Native](https://reactnativeexample.com/device-information-for-react-native-ios-and-android/#getuniqueid).

### **Performance and Reliability**
- Built with:
  - **React 18** and **React Native 0.75**
  - **TypeScript** for modern, type-safe development.
- Compatible with:
  - **iOS 13.4+** and **Android 7+**
- Requires **Node.js 20+** for development.

---

## Getting Started

### Development Setup
1. **Clone the Repository**  
   ```bash
   git clone https://github.com/RunOnFlux/ssp-key.git
   cd ssp-key
   ```

2. **Install Dependencies**  
   Ensure Node.js (20 or higher) is installed, then run:
   ```bash
   yarn install
   ```

3. **Start the Development Server**  
   Launch the project with:
   ```bash
   yarn start
   ```

4. **Link with SSP Wallet**  
   Follow the integration guide in the [SSP Documentation](https://sspwallet.gitbook.io/docs).

---

## Requirements

- **Node.js**: Version 20 or higher  
- **React Native**: Version 0.75 or higher  
- **Mobile OS**:
  - iOS: Minimum version 13.4
  - Android: Minimum version 7  

---

## Documentation and Support

- **SSP Wallet Ecosystem**: Learn how SSP Key integrates with SSP Wallet in the [SSP Documentation](https://sspwallet.gitbook.io/docs).
- **Disclaimer**: Review the [SSP Key Disclaimer](https://github.com/RunOnFlux/ssp-key/blob/master/DISCLAIMER.md).  
- **Code of Conduct**: See our [Code of Conduct](https://github.com/RunOnFlux/ssp-key/blob/master/CODE_OF_CONDUCT.md).  
- **Contributions**: Check out the [Contributing Guidelines](https://github.com/RunOnFlux/ssp-key/blob/master/CONTRIBUTING.md).  

For further details, visit the [SSP Wallet README](https://github.com/RunOnFlux/ssp-wallet/blob/master/README.md).

---

## Translation

Help make SSP Key accessible globally:  
- **Translate SSP Key**: [translatekey.sspwallet.io](https://translatekey.sspwallet.io)  
- **Translate SSP Wallet**: [translate.sspwallet.io](https://translate.sspwallet.io)  

---

## Acknowledgments

We thank our amazing community for their contributions, which make SSP Key a reliable and secure tool for managing cryptocurrency.

---

By using SSP Key, you agree to the terms in the [Disclaimer](https://github.com/RunOnFlux/ssp-key/blob/master/DISCLAIMER.md). Handle your keys responsibly, and always follow best practices for securing cryptocurrency.
