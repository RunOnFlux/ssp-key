# Contributing to SSP Key

We’re thrilled that you’re considering contributing to SSP Key! Your efforts are vital in improving this powerful two-factor authentication tool and its seamless integration with **[SSP Wallet](https://sspwallet.io)**. Whether you’re reporting bugs, suggesting features, or enhancing the codebase, your contributions are deeply valued.

For detailed technical information, please refer to the [SSP Documentation](https://sspwallet.gitbook.io/docs).

---

## Code of Conduct

Please read and follow our [Code of Conduct](CODE_OF_CONDUCT.md). By participating in this project, you agree to foster a respectful and inclusive environment.

---

## Ways to Contribute

### 1. Report Bugs
If you find a bug:
- [Create an issue](https://github.com/RunOnFlux/ssp-key/issues) and include:
  - Steps to reproduce the issue.
  - Screenshots, logs, or error messages if applicable.
  - Information about your setup (OS, device, app version).

### 2. Suggest Features
Got an idea to improve SSP Key? Submit a feature request in the [issues section](https://github.com/RunOnFlux/ssp-key/issues). Be as detailed as possible and explain the problem it solves.

### 3. Improve Documentation
Help make SSP Key accessible to everyone by contributing to guides, FAQs, or translations. Visit [Crowdin](https://translatekey.sspwallet.io) to contribute to translations. For technical documentation, check the [SSP Documentation](https://sspwallet.gitbook.io/docs).

### 4. Submit Code Contributions
Assist in building new features, fixing bugs, or refining the codebase by submitting a pull request (PR).

---

## Development Environment

### Prerequisites
- **Node.js**: Version 20 or higher
- **Yarn**: Latest version
- **React Native CLI**: Ensure the CLI is properly installed.

### Setting Up
1. Fork the repository.
2. Clone your fork:
   ```bash
   git clone https://github.com/runonflux/ssp-key
   ```
3. Install dependencies:
   ```bash
   yarn install
   ```
4. Start the development server:
   ```bash
   yarn start
   ```

Refer to the [SSP Documentation](https://sspwallet.gitbook.io/docs/) for further setup details.

---

## Coding Guidelines

### Style Guide
- Follow our **ESLint configuration** and use **Prettier** for code formatting.  
- Run the linter before committing:
  ```bash
  yarn lint
  ```

### Prettier Configuration
Ensure your editor supports Prettier.


### Type Checking
The project uses TypeScript. Run type checks locally with:
```bash
yarn type-check
```

### Testing
- Write tests for new features or bug fixes.
- Run tests locally to ensure all tests pass:
  ```bash
  yarn test
  ```

---

## Submitting a Pull Request

Follow these steps to submit a PR:

1. **Create a New Branch**  
   Use a descriptive branch name:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make Changes**  
   - Keep changes focused on a specific issue or feature.  
   - Ensure tests and linter checks pass before committing.

3. **Commit Changes**  
   Write clear, descriptive commit messages:
   ```bash
   git commit -m "Add feature: your-feature-description"
   ```

4. **Push to Your Fork**  
   ```bash
   git push origin feature/your-feature-name
   ```

5. **Open a Pull Request**  
   - Go to your fork and create a pull request against the `main` branch of the SSP Key repository.
   - Provide a summary of your changes and link to any relevant issues.

### PR Tips
- Follow our coding standards and include tests.
- Keep your PR concise and focused.
- Open a draft PR for early feedback on significant changes.

---

## Resources

- [SSP Documentation](https://sspwallet.gitbook.io/docs)  
- [How to Contribute to Open Source](https://opensource.guide/how-to-contribute/)  
- [GitHub Help](https://help.github.com)  

---

## Need Help?

If you have questions or encounter issues:
- Open an issue on GitHub.
- Consult the [SSP Documentation](https://sspwallet.gitbook.io/docs).  
- Join the community via [SSP Wallet Discord](https://discord.gg/runonflux).

We’re excited to have you on board. Together, let’s make SSP Key a secure, simple, and powerful tool for the crypto community!
