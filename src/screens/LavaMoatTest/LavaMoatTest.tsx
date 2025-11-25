import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme } from '../../hooks';

interface TestResult {
  message: string;
  type: 'info' | 'pass' | 'fail' | 'warning';
  timestamp: string;
}

interface Props {
  navigation: any;
}

const LavaMoatTest: React.FC<Props> = ({ navigation }) => {
  const { darkMode } = useTheme();
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  const logTest = (message: string, type: TestResult['type'] = 'info') => {
    const result: TestResult = {
      message,
      type,
      timestamp: new Date().toISOString(),
    };
    setTestResults((prev) => [...prev, result]);
  };

  const clearResults = () => {
    setTestResults([]);
  };

  const runSecurityTests = () => {
    setIsRunning(true);
    clearResults();

    logTest('🚀 LavaMoat Security Test Suite', 'info');
    logTest('🔐 @lavamoat/react-native-lockdown v0.0.2', 'info');
    logTest('━━━━━━━━━━━━━━━━━━━━━━━━', 'info');

    // Check if hardenIntrinsics is available in global scope
    const hardenIntrinsicsExists =
      typeof (global as any).hardenIntrinsics === 'function';
    logTest(
      `🔍 hardenIntrinsics function: ${hardenIntrinsicsExists ? 'FOUND' : 'NOT FOUND'}`,
      hardenIntrinsicsExists ? 'pass' : 'fail',
    );

    // Check if SES/Lockdown was initialized
    const sesExists = typeof (global as any).lockdown === 'function';
    logTest(
      `🔍 lockdown function: ${sesExists ? 'FOUND' : 'NOT FOUND'}`,
      sesExists ? 'pass' : 'fail',
    );

    // Check if prototypes are already frozen (which means hardenIntrinsics was called)
    const functionPrototypeFrozen = Object.isFrozen(Function.prototype);
    const objectPrototypeFrozen = Object.isFrozen(Object.prototype);
    logTest(
      `🔍 Function.prototype frozen: ${functionPrototypeFrozen ? 'YES' : 'NO'}`,
      functionPrototypeFrozen ? 'pass' : 'fail',
    );
    logTest(
      `🔍 Object.prototype frozen: ${objectPrototypeFrozen ? 'YES' : 'NO'}`,
      objectPrototypeFrozen ? 'pass' : 'fail',
    );

    logTest('━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    logTest('📋 SECURITY MODEL:', 'info');
    logTest('✅ Intrinsic Hardening - Core JS objects frozen', 'info');
    logTest('✅ Prototype Protection - Pollution attacks blocked', 'info');
    logTest('⚠️  No Compartmentalization - Not available for RN', 'info');
    logTest('⚠️  evalTaming: unsafe-eval - Required for RN/Metro', 'info');
    logTest('━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    logTest('NOTE: eval/Function/Proxy/Reflect warnings are expected.', 'info');
    logTest('React Native ecosystem requires these for compatibility.', 'info');
    logTest('━━━━━━━━━━━━━━━━━━━━━━━━', 'info');

    // Test 1: Function.prototype Modification Protection
    logTest('🧪 Test 1: Function.prototype Modification Protection', 'info');

    // Check if Function.prototype is frozen (works in both strict and sloppy mode)
    const isFunctionPrototypeFrozen = Object.isFrozen(Function.prototype);

    if (isFunctionPrototypeFrozen) {
      // Verify by checking if property is writable
      const applyDescriptor = Object.getOwnPropertyDescriptor(
        Function.prototype,
        'apply',
      );
      const isProtected =
        applyDescriptor &&
        !applyDescriptor.writable &&
        !applyDescriptor.configurable;

      if (isProtected) {
        logTest('✅ PASS: Function.prototype is frozen and protected', 'pass');
      } else {
        logTest(
          '⚠️  WARNING: Function.prototype is frozen but properties are writable',
          'warning',
        );
      }
    } else {
      logTest(
        '❌ FAIL: Function.prototype is not frozen - Lockdown not active',
        'fail',
      );
    }

    // Test 2: Object.prototype Modification
    logTest('🧪 Test 2: Object.prototype Pollution Protection', 'info');

    const isObjectPrototypeFrozen = Object.isFrozen(Object.prototype);

    if (isObjectPrototypeFrozen) {
      logTest(
        '✅ PASS: Object.prototype is frozen and protected from pollution',
        'pass',
      );
    } else {
      logTest('❌ FAIL: Object.prototype is not frozen', 'fail');
    }

    // Test 3: Array.prototype Modification
    logTest('🧪 Test 3: Array.prototype Protection', 'info');

    const isArrayPrototypeFrozen = Object.isFrozen(Array.prototype);

    if (isArrayPrototypeFrozen) {
      const pushDescriptor = Object.getOwnPropertyDescriptor(
        Array.prototype,
        'push',
      );
      const isProtected =
        pushDescriptor &&
        !pushDescriptor.writable &&
        !pushDescriptor.configurable;

      if (isProtected) {
        logTest('✅ PASS: Array.prototype is frozen and protected', 'pass');
      } else {
        logTest(
          '⚠️  WARNING: Array.prototype is frozen but properties are writable',
          'warning',
        );
      }
    } else {
      logTest('❌ FAIL: Array.prototype is not frozen', 'fail');
    }

    // Test 4: Global Object Property Addition
    logTest('🧪 Test 4: Global Object Property Addition', 'info');
    try {
      // Note: LavaMoat allows global property addition for RN compatibility
      (global as any).__testProp = 'test';
      delete (global as any).__testProp;

      logTest(
        '⚠️  WARNING: Global properties can be added (expected in RN)',
        'warning',
      );
    } catch (error) {
      logTest(
        '✅ PASS: Global object frozen - ' + (error as Error).message,
        'pass',
      );
    }

    // Test 5: Function Constructor (Expected to work in RN)
    logTest('🧪 Test 5: Function Constructor Availability', 'info');
    try {
      const FunctionConstructor = Function;
      const testFn = new FunctionConstructor('return 42');
      testFn(); // Execute but don't store unused result

      logTest(
        '⚠️  WARNING: Function constructor available (evalTaming: unsafe-eval for RN)',
        'warning',
      );
    } catch (error) {
      logTest(
        '✅ PASS: Function constructor blocked - ' + (error as Error).message,
        'pass',
      );
    }

    // Test 6: eval() Availability (Expected to work in RN)
    logTest('🧪 Test 6: eval() Availability', 'info');
    try {
      eval('"test"'); // Execute but don't store unused result

      logTest(
        '⚠️  WARNING: eval() available (evalTaming: unsafe-eval for RN)',
        'warning',
      );
    } catch (error) {
      logTest('✅ PASS: eval() blocked - ' + (error as Error).message, 'pass');
    }

    // Test 7: Constructor.constructor Access
    logTest('🧪 Test 7: Constructor.constructor Attack Vector', 'info');
    try {
      const obj: any = {};
      const FunctionViaConstructor = obj.constructor.constructor;
      const maliciousCode = new FunctionViaConstructor(
        'return "BREACH: constructor.constructor works"',
      );
      const result = maliciousCode();

      logTest(
        '❌ FAIL: Constructor.constructor not blocked - ' + result,
        'fail',
      );
    } catch (error) {
      logTest(
        '✅ PASS: Constructor.constructor blocked - ' +
          (error as Error).message,
        'pass',
      );
    }

    // Test 8: Proxy Availability
    logTest('🧪 Test 8: Proxy Availability', 'info');
    try {
      if (typeof Proxy !== 'undefined') {
        // Test if Proxy works
        const handler = {
          get: () => 'test',
        };
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const proxy = new Proxy({}, handler);
        logTest(
          '⚠️  WARNING: Proxy available (required for RN reactivity)',
          'warning',
        );
      } else {
        logTest('✅ PASS: Proxy is restricted', 'pass');
      }
    } catch (error) {
      logTest('✅ PASS: Proxy blocked - ' + (error as Error).message, 'pass');
    }

    // Test 9: Reflect API Availability
    logTest('🧪 Test 9: Reflect API Availability', 'info');
    try {
      if (typeof Reflect !== 'undefined' && Reflect.construct) {
        const TestFunc = function (this: any) {
          this.test = true;
        };
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const instance = Reflect.construct(TestFunc, []);
        logTest(
          '⚠️  WARNING: Reflect.construct available (required for RN)',
          'warning',
        );
      } else {
        logTest('✅ PASS: Reflect API is restricted', 'pass');
      }
    } catch (error) {
      logTest(
        '✅ PASS: Reflect API blocked - ' + (error as Error).message,
        'pass',
      );
    }

    // Test 10: Normal Operations Still Work
    logTest('🧪 Test 10: Normal JavaScript Operations', 'info');
    try {
      const testArray = [1, 2, 3, 4, 5];
      const doubled = testArray.map((x) => x * 2);
      const sum = doubled.reduce((a, b) => a + b, 0);
      const output = JSON.stringify({ doubled, sum });

      logTest('✅ PASS: Normal operations work - ' + output, 'pass');
    } catch {
      logTest('❌ FAIL: Basic operations broken!', 'fail');
    }

    // Summary - use setTimeout to ensure state updates have completed
    setTimeout(() => {
      logTest('━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
      logTest('🎯 Test Suite Complete', 'info');

      setTestResults((prev) => {
        const passCount = prev.filter((r) => r.type === 'pass').length;
        const failCount = prev.filter((r) => r.type === 'fail').length;
        const warnCount = prev.filter((r) => r.type === 'warning').length;

        const summaryResults = [
          ...prev,
          {
            message: `✅ Protected: ${passCount} | ❌ Vulnerable: ${failCount} | ⚠️  Warnings: ${warnCount}`,
            type: 'info' as const,
            timestamp: new Date().toISOString(),
          },
          {
            message: '━━━━━━━━━━━━━━━━━━━━━━━━',
            type: 'info' as const,
            timestamp: new Date().toISOString(),
          },
          {
            message: 'ℹ️  INTERPRETATION:',
            type: 'info' as const,
            timestamp: new Date().toISOString(),
          },
        ];

        if (failCount > 0) {
          summaryResults.push({
            message: '❌ CRITICAL: Unexpected vulnerabilities detected!',
            type: 'fail' as const,
            timestamp: new Date().toISOString(),
          });
        } else if (passCount >= 3) {
          summaryResults.push({
            message: '✅ GOOD: Core protections active (prototypes frozen)',
            type: 'pass' as const,
            timestamp: new Date().toISOString(),
          });
          summaryResults.push({
            message: '⚠️  Warnings are expected - RN compatibility mode',
            type: 'info' as const,
            timestamp: new Date().toISOString(),
          });
        } else {
          summaryResults.push({
            message: '⚠️  Partial protection - review results above',
            type: 'warning' as const,
            timestamp: new Date().toISOString(),
          });
        }

        return summaryResults;
      });

      setIsRunning(false);
    }, 100);
  };

  // Auto-run tests on mount
  useEffect(() => {
    runSecurityTests();
  }, []);

  const getTextColor = (type: TestResult['type']): string => {
    switch (type) {
      case 'pass':
        return darkMode ? '#73d13d' : '#52c41a'; // Green
      case 'fail':
        return darkMode ? '#ff7875' : '#ff4d4f'; // Red
      case 'warning':
        return darkMode ? '#ffc53d' : '#faad14'; // Orange
      default:
        return darkMode ? '#999' : '#666'; // Gray
    }
  };

  const getBackgroundColor = (type: TestResult['type']): string => {
    if (darkMode) {
      switch (type) {
        case 'pass':
          return '#162312'; // Dark green
        case 'fail':
          return '#2a1215'; // Dark red
        case 'warning':
          return '#2b2111'; // Dark yellow
        default:
          return 'transparent';
      }
    } else {
      switch (type) {
        case 'pass':
          return '#f6ffed'; // Light green
        case 'fail':
          return '#fff2f0'; // Light red
        case 'warning':
          return '#fffbe6'; // Light yellow
        default:
          return 'transparent';
      }
    }
  };

  const shouldShowResult = (result: TestResult): boolean => {
    // Hide info messages that are just test headers (start with 🧪)
    if (result.type === 'info' && result.message.startsWith('🧪')) {
      return false;
    }
    return true;
  };

  const isDivider = (message: string): boolean => {
    return message.includes('━━━');
  };

  return (
    <SafeAreaView
      style={[
        styles.container,
        { backgroundColor: darkMode ? '#1a1a1a' : '#fff' },
      ]}
    >
      <View
        style={[
          styles.header,
          { backgroundColor: darkMode ? '#000' : '#001529' },
        ]}
      >
        <View style={styles.headerTop}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backButton}
          >
            <Icon name="arrow-left" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.title}>🔒 LavaMoat Security Test</Text>
          <View style={{ width: 24 }} />
        </View>
        <Text style={styles.subtitle}>
          Verifying JavaScript hardening and prototype protection
        </Text>
      </View>

      <View style={styles.buttonContainer}>
        <TouchableOpacity
          style={[
            styles.button,
            styles.primaryButton,
            isRunning && styles.buttonDisabled,
          ]}
          onPress={runSecurityTests}
          disabled={isRunning}
        >
          <Text style={styles.buttonText}>
            {isRunning ? '⏳ Running Tests...' : '▶️  Run Security Tests'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.button,
            styles.secondaryButton,
            isRunning && styles.buttonDisabled,
          ]}
          onPress={clearResults}
          disabled={isRunning}
        >
          <Text style={styles.buttonText}>🗑️ Clear Results</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.resultsContainer}>
        {testResults.length === 0 ? (
          <View style={styles.emptyState}>
            <Text
              style={[styles.emptyText, { color: darkMode ? '#666' : '#999' }]}
            >
              {isRunning
                ? 'Loading test results...'
                : 'No test results. Click "Run Security Tests" to begin.'}
            </Text>
          </View>
        ) : (
          testResults.filter(shouldShowResult).map((result, index) => {
            const isDiv = isDivider(result.message);
            return (
              <View
                key={index}
                style={[
                  isDiv ? styles.dividerItem : styles.resultItem,
                  { backgroundColor: getBackgroundColor(result.type) },
                ]}
              >
                <Text
                  style={[
                    isDiv ? styles.dividerText : styles.resultText,
                    {
                      color: getTextColor(result.type),
                      fontWeight:
                        result.type === 'pass' || result.type === 'fail'
                          ? 'bold'
                          : 'normal',
                    },
                  ]}
                >
                  {result.message}
                </Text>
              </View>
            );
          })
        )}
      </ScrollView>

      <View
        style={[
          styles.footer,
          {
            backgroundColor: darkMode ? '#0a0a0a' : '#f5f5f5',
            borderTopColor: darkMode ? '#333' : '#d9d9d9',
          },
        ]}
      >
        <Text
          style={[styles.footerText, { color: darkMode ? '#999' : '#666' }]}
        >
          ✅ = Protected | ❌ = Vulnerable | ⚠️ = Allowed (RN Compatibility)
        </Text>
        <Text
          style={[
            styles.footerText,
            { marginTop: 4, color: darkMode ? '#999' : '#666' },
          ]}
        >
          LavaMoat hardens intrinsics while maintaining React Native
          compatibility
        </Text>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    padding: 16,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  backButton: {
    padding: 4,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
  },
  subtitle: {
    fontSize: 13,
    color: '#aaa',
    marginTop: 4,
  },
  buttonContainer: {
    flexDirection: 'row',
    padding: 12,
    gap: 10,
  },
  button: {
    flex: 1,
    padding: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  primaryButton: {
    backgroundColor: '#1890ff',
  },
  secondaryButton: {
    backgroundColor: '#666',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  resultsContainer: {
    flex: 1,
    padding: 12,
  },
  emptyState: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
  },
  resultItem: {
    padding: 8,
    marginBottom: 4,
    borderRadius: 4,
    borderLeftWidth: 3,
    borderLeftColor: '#1890ff',
  },
  resultText: {
    fontSize: 12,
    fontFamily: 'monospace',
    lineHeight: 16,
  },
  dividerItem: {
    paddingVertical: 8,
    marginVertical: 4,
  },
  dividerText: {
    fontSize: 12,
    textAlign: 'center',
    opacity: 0.3,
  },
  footer: {
    padding: 12,
    borderTopWidth: 1,
  },
  footerText: {
    fontSize: 11,
    textAlign: 'center',
  },
});

export default LavaMoatTest;
