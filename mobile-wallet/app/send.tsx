/**
 * @fileoverview Send transaction modal.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Keyboard,
  Platform,
  Modal,
  StyleSheet,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useSendScreenSelector } from '../store';
import type { Token, GasEstimate } from '../services';
import {
  isValidTonAddress,
  isValidEvmAddress,
  isValidBitcoinAddress,
  isValidSolanaAddress,
  isValidXRPAddress,
  isValidDestinationTag,
} from '../services';
import { useClipboard } from '../hooks';
import { KeyboardAwareScrollView } from '../components/KeyboardAwareScrollView';
import { safeGoBack } from '../utils/navigation';
import { formatDecimal, formatTokenAmountDisplay } from '../utils/amounts';

type SendStep = 'select-token' | 'select-recipient' | 'enter-amount' | 'confirm';
type AmountMode = 'token' | 'fiat';

export default function SendScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    balances,
    prices,
    network,
    networks,
    getGasEstimate,
    sendTransaction,
  } = useSendScreenSelector();

  const [selectedToken, setSelectedToken] = useState<Token | null>(null);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [displayAmount, setDisplayAmount] = useState('');
  const [amountMode, setAmountMode] = useState<AmountMode>('token');
  const [gasEstimate, setGasEstimate] = useState<GasEstimate | null>(null);
  const [isEstimating, setIsEstimating] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [step, setStep] = useState<SendStep>('select-token');
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [isAmountFocused, setIsAmountFocused] = useState(false);
  const { copy } = useClipboard();

  // QR Scanner state
  const [showScanner, setShowScanner] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [hasScanned, setHasScanned] = useState(false);
  const [scanStatus, setScanStatus] = useState<'idle' | 'scanned' | 'copied' | 'error'>('idle');
  const [scanError, setScanError] = useState('');
  const [scannedAddress, setScannedAddress] = useState('');
  const [scannedMeta, setScannedMeta] = useState<{ amount?: string; destinationTag?: string } | null>(null);

  // XRP destination tag state
  const [destinationTag, setDestinationTag] = useState('');

  // TON comment state
  const [comment, setComment] = useState('');
  const [noteExpanded, setNoteExpanded] = useState(false);

  const networkConfig = networks[network];
  const isXRPNetwork = networkConfig?.type === 'xrp';
  const isTonNetwork = networkConfig?.type === 'ton';
  const isBitcoinNetwork = networkConfig?.type === 'bitcoin';
  const isSolanaNetwork = networkConfig?.type === 'solana';
  const isEvmNetwork = !networkConfig?.type || networkConfig?.type === 'evm';
  const footerHeight = 120;
  const footerOffset =
    keyboardHeight > 0 ? Math.max(keyboardHeight - insets.bottom, 0) : insets.bottom;

  const tokenPrice = selectedToken ? prices[selectedToken.symbol] ?? null : null;
  const hasTokenPrice =
    typeof tokenPrice === 'number' && Number.isFinite(tokenPrice) && tokenPrice > 0;

  // Set default token on mount
  useEffect(() => {
    if (balances.length > 0 && !selectedToken) {
      setSelectedToken(balances[0].token);
      setStep('select-recipient');
    }
  }, [balances, selectedToken]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (event) => {
      setKeyboardHeight(event.endCoordinates?.height ?? 0);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useEffect(() => {
    if (amountMode !== 'fiat') return;
    if (!hasTokenPrice) {
      setDisplayAmount('');
      setAmount('');
      return;
    }
    if (!amount) return;
    const fiatValue = parseFloat(amount) * tokenPrice;
    if (!Number.isFinite(fiatValue)) return;
    setDisplayAmount(formatDecimal(fiatValue, 2));
  }, [amountMode, hasTokenPrice, amount, tokenPrice]);

  const titleByStep = useMemo(() => {
    switch (step) {
      case 'select-token':
        return 'Send';
      case 'select-recipient':
        return 'Recipient';
      case 'enter-amount':
        return 'Enter Amount';
      case 'confirm':
        return 'Summary';
      default:
        return 'Send';
    }
  }, [step]);

  const handleHeaderBack = () => {
    if (step === 'select-token') {
      safeGoBack(router);
      return;
    }
    if (step === 'select-recipient') {
      setStep('select-token');
      return;
    }
    if (step === 'enter-amount') {
      setStep('select-recipient');
      return;
    }
    setStep('enter-amount');
  };

  // Estimate gas when amount and recipient are valid
  const estimateGas = useCallback(async () => {
    if (!selectedToken || !recipient || !amount) return;

    // Basic validation
    if (recipient.length < 10) return;
    if (!isValidAmountInput(amount)) return;
    if (parseFloat(amount) <= 0) return;
    if (!isValidRecipient(recipient)) {
      setGasEstimate(null);
      return;
    }

    try {
      setIsEstimating(true);
      const estimate = await getGasEstimate(selectedToken, recipient, amount);
      setGasEstimate(estimate);
    } catch (error) {
      console.error('Gas estimation failed:', error);
      setGasEstimate(null);
    } finally {
      setIsEstimating(false);
    }
  }, [selectedToken, recipient, amount, getGasEstimate]);

  // Debounce gas estimation
  useEffect(() => {
    const timer = setTimeout(estimateGas, 500);
    return () => clearTimeout(timer);
  }, [estimateGas]);

  const handleTokenSelect = (token: Token) => {
    setSelectedToken(token);
    setAmount('');
    setDisplayAmount('');
    setGasEstimate(null);
    setStep('select-recipient');
  };

  const handleRecipientContinue = () => {
    if (!selectedToken) return;
    if (!recipient) {
      Alert.alert('Error', 'Please enter a recipient address');
      return;
    }
    if (isEvmNetwork && looksLikeEns(recipient)) {
      Alert.alert('ENS Unsupported', 'ENS names are not supported yet. Please enter a 0x address.');
      return;
    }
    if (!isValidRecipient(recipient)) {
      Alert.alert('Invalid Address', getInvalidAddressMessage());
      return;
    }
    if (isXRPNetwork && destinationTag && !isValidDestinationTag(destinationTag)) {
      Alert.alert('Invalid Destination Tag', 'Destination tag must be a valid uint32 value.');
      return;
    }
    setStep('enter-amount');
  };

  const handleAmountContinue = () => {
    if (!selectedToken || !recipient || !amount) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }
    if (!isValidAmountInput(amount) || parseFloat(amount) <= 0) {
      Alert.alert('Error', 'Please enter a valid amount');
      return;
    }
    if (isNativeToken() && !hasValidFeeEstimate()) {
      Alert.alert('Fee Estimate Required', 'Please wait for a network fee estimate before sending.');
      return;
    }
    if (!isAmountWithinBalance(amount)) {
      Alert.alert('Insufficient Balance', getInsufficientBalanceMessage());
      return;
    }
    setStep('confirm');
  };

  const handleSend = async () => {
    if (!selectedToken) return;

    try {
      setIsSending(true);

      // Parse destination tag for XRP transactions
      const tag = isXRPNetwork && destinationTag
        ? parseInt(destinationTag, 10)
        : undefined;

      // Get comment for TON transactions
      const tonComment = isTonNetwork && comment ? comment : undefined;

      const result = await sendTransaction(selectedToken, recipient, amount, tag, tonComment);
      const displayDecimals = getDisplayDecimals();
      const amountDisplay = formatTokenAmountDisplay(amount, displayDecimals);
      const feeDisplay = gasEstimate?.estimatedCostNative
        ? formatTokenAmountDisplay(gasEstimate.estimatedCostNative, displayDecimals)
        : '';

      router.replace({
        pathname: '/send-status',
        params: {
          hash: result.hash,
          status: result.status,
          amount,
          amountDisplay,
          symbol: selectedToken.symbol,
          recipient,
          network,
          fee: gasEstimate?.estimatedCostNative ?? '',
          feeDisplay,
          feeSymbol: gasEstimate?.nativeSymbol ?? '',
          destinationTag: isXRPNetwork ? destinationTag : '',
          comment: isTonNetwork ? comment : '',
        },
      } as any);
    } catch (error) {
      Alert.alert('Transaction Failed', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setIsSending(false);
    }
  };

  const getTokenBalance = (symbol: string) => {
    const item = balances.find((b) => b.token.symbol === symbol);
    // Ensure we always return a string, even if balance is null/undefined
    return typeof item?.balance === 'string' ? item.balance : '0';
  };

  const setAmountFromTokenValue = (value: string) => {
    setAmount(value);
    if (amountMode === 'token') {
      setDisplayAmount(value);
      return;
    }
    if (!hasTokenPrice) {
      setDisplayAmount('');
      return;
    }
    if (!value) {
      setDisplayAmount('');
      return;
    }
    const fiatValue = parseFloat(value) * tokenPrice;
    if (!Number.isFinite(fiatValue)) {
      setDisplayAmount('');
      return;
    }
    setDisplayAmount(formatDecimal(fiatValue, 2));
  };

  const handleMax = () => {
    if (!selectedToken) return;
    if (isNativeToken() && !recipient) {
      Alert.alert('Enter Recipient', 'Please enter a recipient address before using Max.');
      return;
    }
    const maxValue = getSpendableBalance();
    setAmountFromTokenValue(maxValue);
  };

  const handlePercent = (percent: number) => {
    if (!selectedToken) return;
    if (isNativeToken() && !recipient) {
      Alert.alert('Enter Recipient', 'Please enter a recipient address before using quick amounts.');
      return;
    }
    const decimals = getTokenDecimals();
    const balance = getTokenBalance(selectedToken.symbol);
    const balanceInt = parseDecimalToBigInt(balance, decimals);
    const spendableInt = getSpendableBalanceInt(balanceInt, decimals);
    if (spendableInt <= 0n) {
      setAmountFromTokenValue('0');
      return;
    }
    const amountInt = (spendableInt * BigInt(percent)) / 100n;
    setAmountFromTokenValue(formatBigIntToDecimal(amountInt, decimals));
  };

  const handleAmountChange = (value: string) => {
    const normalized = normalizeAmountInput(value);
    setDisplayAmount(normalized);
    if (amountMode === 'token') {
      setAmount(normalized);
      return;
    }
    if (!hasTokenPrice || !normalized) {
      setAmount('');
      return;
    }
    const fiatValue = parseFloat(normalized);
    if (!Number.isFinite(fiatValue) || fiatValue <= 0) {
      setAmount('');
      return;
    }
    const decimals = Math.min(8, getTokenDecimals());
    const tokenValue = fiatValue / tokenPrice;
    setAmount(formatDecimal(tokenValue, decimals));
  };

  const handleToggleCurrency = () => {
    if (!hasTokenPrice) return;
    if (amountMode === 'token') {
      setAmountMode('fiat');
      if (amount) {
        const fiatValue = parseFloat(amount) * tokenPrice;
        setDisplayAmount(Number.isFinite(fiatValue) ? formatDecimal(fiatValue, 2) : '');
      } else {
        setDisplayAmount('');
      }
      return;
    }
    setAmountMode('token');
    setDisplayAmount(amount);
  };

  const getConversionText = () => {
    if (!selectedToken) return '';
    if (!hasTokenPrice) return 'Price unavailable';
    if (!amount) return '';
    const tokenValue = parseFloat(amount);
    if (!Number.isFinite(tokenValue)) return '';
    if (amountMode === 'token') {
      const fiatValue = tokenValue * tokenPrice;
      return `~$${formatDecimal(fiatValue, 2)}`;
    }
    return `~${formatDecimal(tokenValue, Math.min(8, getTokenDecimals()))} ${selectedToken.symbol}`;
  };

  const getUsdConversionText = () => {
    if (!hasTokenPrice || !amount) return '';
    const tokenValue = parseFloat(amount);
    if (!Number.isFinite(tokenValue)) return '';
    const fiatValue = tokenValue * tokenPrice;
    return `~$${formatDecimal(fiatValue, 2)}`;
  };

  const getBitcoinNetwork = () => {
    if (!isBitcoinNetwork) return 'mainnet';
    if (networkConfig?.bitcoinNetwork) return networkConfig.bitcoinNetwork;
    if (networkConfig?.isTestnet || network.toLowerCase().includes('test')) return 'testnet';
    return 'mainnet';
  };

  const isValidRecipient = (address: string) => {
    if (isEvmNetwork) return isValidEvmAddress(address);
    if (isBitcoinNetwork) return isValidBitcoinAddress(address, getBitcoinNetwork());
    if (isSolanaNetwork) return isValidSolanaAddress(address);
    if (isXRPNetwork) return isValidXRPAddress(address);
    if (isTonNetwork) return isValidTonAddress(address);
    return false;
  };

  const getInvalidAddressMessage = () => {
    if (isBitcoinNetwork) return 'Please enter a valid Bitcoin address for this network.';
    if (isSolanaNetwork) return 'Please enter a valid Solana address.';
    if (isXRPNetwork) return 'Please enter a valid XRP address.';
    if (isTonNetwork) return 'Please enter a valid TON address (e.g., EQ... or UQ... format).';
    return 'Please enter a valid EVM address (0x...).';
  };

  const getTokenDecimals = () => {
    if (selectedToken?.decimals !== undefined) return selectedToken.decimals;
    if (isBitcoinNetwork) return 8;
    if (isSolanaNetwork || isTonNetwork) return 9;
    if (isXRPNetwork) return 6;
    return 18;
  };

  const getDisplayDecimals = () => Math.min(8, getTokenDecimals());

  const isNativeToken = () => {
    if (!selectedToken) return false;
    return selectedToken.type === 'native' || selectedToken.address === 'native' || !selectedToken.address;
  };

  const hasValidFeeEstimate = () => {
    if (!gasEstimate || gasEstimate.error) return false;
    const fee = parseFloat(gasEstimate.estimatedCostNative || '0');
    return Number.isFinite(fee) && fee > 0;
  };

  const getSpendableBalanceInt = (balanceInt: bigint, decimals: number) => {
    if (!isNativeToken()) return balanceInt;
    if (!hasValidFeeEstimate()) return balanceInt;
    const feeInt = parseDecimalToBigInt(gasEstimate?.estimatedCostNative || '0', decimals);
    const spendable = balanceInt - feeInt;
    return spendable > 0n ? spendable : 0n;
  };

  const getSpendableBalance = () => {
    if (!selectedToken) return '0';
    const decimals = getTokenDecimals();
    const balance = getTokenBalance(selectedToken.symbol);
    const balanceInt = parseDecimalToBigInt(balance, decimals);
    const spendableInt = getSpendableBalanceInt(balanceInt, decimals);
    return formatBigIntToDecimal(spendableInt, decimals);
  };

  const isAmountWithinBalance = (value: string) => {
    if (!selectedToken) return false;
    const decimals = getTokenDecimals();
    const balance = getTokenBalance(selectedToken.symbol);
    const balanceInt = parseDecimalToBigInt(balance, decimals);
    const amountInt = parseDecimalToBigInt(value, decimals);
    if (isNativeToken()) {
      if (!hasValidFeeEstimate()) return false;
      const feeInt = parseDecimalToBigInt(gasEstimate?.estimatedCostNative || '0', decimals);
      return amountInt <= balanceInt - feeInt;
    }
    return amountInt <= balanceInt;
  };

  const getInsufficientBalanceMessage = () => {
    if (isNativeToken()) return 'Amount exceeds spendable balance after fees.';
    return 'Amount exceeds available balance.';
  };

  const parseDecimalToBigInt = (value: string, decimals: number) => {
    // Defensive: handle non-string inputs (null, undefined, number)
    if (value == null || typeof value !== 'string') return 0n;
    const sanitized = value.trim();
    if (!sanitized) return 0n;
    const [wholeRaw, fracRaw = ''] = sanitized.split('.');
    const whole = wholeRaw || '0';
    const frac = fracRaw.padEnd(decimals, '0').slice(0, decimals);
    const combined = `${whole}${frac}`.replace(/^0+(?=\d)/, '');
    return BigInt(combined || '0');
  };

  const formatBigIntToDecimal = (value: bigint, decimals: number) => {
    const negative = value < 0n;
    const abs = negative ? -value : value;
    const padded = abs.toString().padStart(decimals + 1, '0');
    const whole = padded.slice(0, -decimals) || '0';
    const frac = padded.slice(-decimals).replace(/0+$/, '');
    return `${negative ? '-' : ''}${frac ? `${whole}.${frac}` : whole}`;
  };

  const normalizeAmountInput = (value: string) => {
    let sanitized = value.replace(/[^0-9.]/g, '');
    const firstDot = sanitized.indexOf('.');
    if (firstDot !== -1) {
      const decimalLimit = amountMode === 'fiat' ? 2 : getDisplayDecimals();
      sanitized =
        sanitized.slice(0, firstDot + 1) +
        sanitized
          .slice(firstDot + 1)
          .replace(/\./g, '')
          .slice(0, decimalLimit);
    }
    if (sanitized.startsWith('.')) {
      sanitized = `0${sanitized}`;
    }
    return sanitized;
  };

  const isValidAmountInput = (value: string) => /^\d+(\.\d+)?$/.test(value);

  const looksLikeEns = (value: string) => /.+\.eth$/i.test(value.trim());

  const getBalanceUsdText = () => {
    if (!selectedToken || !hasTokenPrice) return '';
    const balance = parseFloat(getSpendableBalance());
    if (!Number.isFinite(balance)) return '';
    const usdValue = balance * tokenPrice;
    if (!Number.isFinite(usdValue)) return '';
    return `~$${formatDecimal(usdValue, 2)}`;
  };

  const parseScannedData = (data: string) => {
    let address = data.trim();
    let scannedDestinationTag: string | undefined;
    let scannedAmount: string | undefined;

    if (data.includes(':')) {
      const schemeEnd = data.indexOf(':');
      const scheme = data.slice(0, schemeEnd).toLowerCase();
      let rest = data.slice(schemeEnd + 1);

      if (rest.startsWith('//')) {
        rest = rest.slice(2);
      }

      let [addressPart, queryString] = rest.split('?');

      if (scheme === 'ton') {
        if (addressPart.startsWith('transfer/')) {
          addressPart = addressPart.slice('transfer/'.length);
        } else if (addressPart === 'transfer') {
          addressPart = '';
        }
      }

      address = addressPart;

      if (queryString) {
        const params = new URLSearchParams(queryString);
        const dt = params.get('dt') || params.get('tag') || params.get('destination_tag');
        if (dt) {
          scannedDestinationTag = dt;
        }
        const amountParam = params.get('amount');
        if (amountParam) {
          scannedAmount = amountParam;
        }
        if (!address) {
          address =
            params.get('address') ||
            params.get('to') ||
            params.get('recipient') ||
            '';
        }
      }
    }

    return { address, scannedDestinationTag, scannedAmount };
  };

  const closeScanner = useCallback(() => {
    setShowScanner(false);
    setHasScanned(false);
    setScanStatus('idle');
    setScanError('');
    setScannedAddress('');
    setScannedMeta(null);
  }, []);

  const handleOpenScanner = async () => {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        Alert.alert(
          'Camera Permission Required',
          'Please enable camera access in your device settings to scan QR codes.'
        );
        return;
      }
    }
    setHasScanned(false);
    setScanStatus('idle');
    setScanError('');
    setScannedAddress('');
    setScannedMeta(null);
    setShowScanner(true);
  };

  const handleBarCodeScanned = async ({ data }: { data: string }) => {
    if (hasScanned) return;
    setHasScanned(true);
    setScanStatus('idle');
    setScanError('');

    // Parse the scanned data - could be a plain address or a URI
    const { address, scannedDestinationTag, scannedAmount } = parseScannedData(data);

    if (!address || address.length < 6) {
      setScanStatus('error');
      setScanError('We could not read this QR code. Try again.');
      setHasScanned(false);
      return;
    }

    setScanStatus('scanned');
    setRecipient(address);
    setScannedAddress(address);
    setScannedMeta({
      amount: scannedAmount,
      destinationTag: scannedDestinationTag,
    });

    if (scannedDestinationTag && isXRPNetwork) {
      setDestinationTag(scannedDestinationTag);
    }
    if (scannedAmount) {
      setAmountFromTokenValue(normalizeAmountInput(scannedAmount));
    }
    const copied = await copy(address);
    if (copied) {
      setScanStatus('copied');
    } else {
      setScanStatus('error');
      setScanError('Unable to copy the address. Try again.');
      setHasScanned(false);
    }
  };

  const handleScanAgain = () => {
    setHasScanned(false);
    setScanStatus('idle');
    setScanError('');
    setScannedAddress('');
    setScannedMeta(null);
  };

  useEffect(() => {
    if (scanStatus !== 'copied') return;
    const timer = setTimeout(() => {
      closeScanner();
    }, 800);
    return () => clearTimeout(timer);
  }, [scanStatus, closeScanner]);

  useEffect(() => {
    if (scanStatus !== 'error') return;
    const timer = setTimeout(() => {
      if (showScanner) {
        handleScanAgain();
      }
    }, 1200);
    return () => clearTimeout(timer);
  }, [scanStatus, showScanner]);

  return (
    <SafeAreaView className="flex-1 bg-gray-950">
      <View className="flex-1">
        {/* Header */}
        <View className="flex-row items-center justify-between px-5 pb-4 border-b border-gray-800">
          <TouchableOpacity onPress={handleHeaderBack}>
            <Ionicons name={step === 'select-token' ? 'close' : 'chevron-back'} size={28} color="white" />
          </TouchableOpacity>
          <Text className="text-white text-xl font-bold">{titleByStep}</Text>
          <View className="w-7" />
        </View>

        {/* Step: Select Token */}
        {step === 'select-token' && (
          <KeyboardAwareScrollView className="flex-1 px-5 pt-4">
            <Text className="text-gray-400 mb-4">Select token to send</Text>
            {balances.map((item, index) => (
              <TouchableOpacity
                key={`${item.token.symbol}-${index}`}
                onPress={() => handleTokenSelect(item.token)}
                className="flex-row items-center py-4 border-b border-gray-800"
              >
                <View className="w-10 h-10 rounded-full bg-gray-800 items-center justify-center mr-3">
                  <Text className="text-white font-bold">{item.token.symbol.charAt(0)}</Text>
                </View>
                <View className="flex-1">
                  <Text className="text-white font-medium">{item.token.name}</Text>
                  <Text className="text-gray-500 text-sm">{item.token.symbol}</Text>
                </View>
                <Text className="text-white">
                  {parseFloat(item.balance || '0').toFixed(4)}
                </Text>
              </TouchableOpacity>
            ))}
          </KeyboardAwareScrollView>
        )}

        {/* Step: Select Recipient */}
        {step === 'select-recipient' && (
          <KeyboardAwareScrollView
            className="flex-1 px-5 pt-4"
            extraBottomPadding={footerHeight + 16}
          >
            <TouchableOpacity
              onPress={() => setStep('select-token')}
              className="flex-row items-center bg-gray-900 rounded-xl p-4 mb-4"
            >
              <View className="w-10 h-10 rounded-full bg-gray-800 items-center justify-center mr-3">
                <Text className="text-white font-bold">
                  {selectedToken?.symbol.charAt(0)}
                </Text>
              </View>
              <View className="flex-1">
                <Text className="text-white font-medium">{selectedToken?.name}</Text>
                <Text className="text-gray-500 text-sm">
                  Balance: {parseFloat(getTokenBalance(selectedToken?.symbol || '')).toFixed(4)}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#6b7280" />
            </TouchableOpacity>

            <View className="mb-4">
              <Text className="text-white mb-2">Recipient Address</Text>
              <View className="flex-row bg-gray-900 rounded-2xl items-center border border-gray-800">
                <TextInput
                  value={recipient}
                  onChangeText={setRecipient}
                  placeholder={
                    isXRPNetwork ? 'rAddress...' :
                    isTonNetwork ? 'EQ... or UQ...' :
                    isBitcoinNetwork ? 'bc1... or 1.../3...' :
                    isSolanaNetwork ? 'Solana address' :
                    '0x...'
                  }
                  placeholderTextColor="#6b7280"
                  autoCapitalize="none"
                  autoCorrect={false}
                  className="flex-1 px-4 py-5 text-white font-mono text-base"
                />
                <TouchableOpacity
                  onPress={handleOpenScanner}
                  className="px-4 py-5"
                  testID="open-qr-scanner"
                >
                  <Ionicons name="qr-code-outline" size={24} color="#a855f7" />
                </TouchableOpacity>
              </View>
            </View>

            {/* XRP Destination Tag */}
            {isXRPNetwork && (
              <View className="mb-4">
                <View className="flex-row justify-between items-center mb-2">
                  <Text className="text-white">Destination Tag</Text>
                  <Text className="text-gray-500 text-sm">(Optional)</Text>
                </View>
                <TextInput
                  value={destinationTag}
                  onChangeText={(text) => {
                    const numericValue = text.replace(/[^0-9]/g, '');
                    setDestinationTag(numericValue);
                  }}
                  placeholder="Enter destination tag (if required)"
                  placeholderTextColor="#6b7280"
                  keyboardType="number-pad"
                  className="bg-gray-900 rounded-xl px-4 py-4 text-white"
                />
                <Text className="text-gray-500 text-xs mt-1">
                  Required by some exchanges and services to identify your deposit
                </Text>
              </View>
            )}
          </KeyboardAwareScrollView>
        )}

        {step === 'select-recipient' && (
          <View
            className="absolute left-0 right-0 px-5"
            style={{ bottom: footerOffset }}
          >
            <View className="bg-gray-950/95 border border-gray-800 rounded-2xl p-3">
              <TouchableOpacity
                onPress={handleRecipientContinue}
                disabled={!recipient}
                className={`rounded-xl py-4 ${
                  recipient ? 'bg-purple-600' : 'bg-gray-800'
                }`}
              >
                <Text className="text-white font-semibold text-center text-lg">
                  Next
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Step: Enter Amount */}
        {step === 'enter-amount' && (
          <KeyboardAwareScrollView
            className="flex-1 px-5 pt-6"
            extraBottomPadding={footerHeight + 24}
          >
            <TouchableOpacity
              onPress={() => setStep('select-token')}
              className="flex-row items-center bg-gray-900 rounded-xl p-4 mb-6"
            >
              <View className="w-10 h-10 rounded-full bg-gray-800 items-center justify-center mr-3">
                <Text className="text-white font-bold">
                  {selectedToken?.symbol.charAt(0)}
                </Text>
              </View>
              <View className="flex-1">
                <Text className="text-white font-medium">{selectedToken?.name}</Text>
                <Text className="text-gray-500 text-sm">
                  Balance: {parseFloat(getTokenBalance(selectedToken?.symbol || '')).toFixed(4)}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#6b7280" />
            </TouchableOpacity>

            <View className="flex-row items-center justify-between mb-4">
              <View>
                <Text className="text-gray-400 text-sm">Available to send</Text>
                <Text className="text-white text-lg font-semibold">
                  {formatTokenAmountDisplay(getSpendableBalance(), getDisplayDecimals())} {selectedToken?.symbol}
                </Text>
                {!!getBalanceUsdText() && (
                  <Text className="text-gray-500 text-sm">{getBalanceUsdText()}</Text>
                )}
              </View>
              <TouchableOpacity onPress={handleMax} className="bg-gray-900 px-4 py-2 rounded-full">
                <Text className="text-purple-400 text-sm">Max</Text>
              </TouchableOpacity>
            </View>

            <View
              className={`bg-gray-900 rounded-3xl border p-4 mb-6 ${
                isAmountFocused ? 'border-purple-500' : 'border-gray-800'
              }`}
            >
              <View className="flex-row items-center justify-between mb-2">
                <Text className="text-gray-500 text-sm">Amount</Text>
                <View className="flex-row bg-gray-950 rounded-full p-1">
                  <TouchableOpacity
                    onPress={() => amountMode !== 'token' && handleToggleCurrency()}
                    disabled={!hasTokenPrice}
                    className={`px-3 py-1 rounded-full ${
                      amountMode === 'token' ? 'bg-gray-800' : ''
                    }`}
                  >
                    <Text className={`${hasTokenPrice ? 'text-white' : 'text-gray-600'} text-xs`}>
                      {selectedToken?.symbol ?? 'Token'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => amountMode !== 'fiat' && handleToggleCurrency()}
                    disabled={!hasTokenPrice}
                    className={`px-3 py-1 rounded-full ${
                      amountMode === 'fiat' ? 'bg-gray-800' : ''
                    }`}
                  >
                    <Text className={`${hasTokenPrice ? 'text-white' : 'text-gray-600'} text-xs`}>
                      USD
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View className="flex-row items-end justify-between">
                <TextInput
                  value={displayAmount}
                  onChangeText={handleAmountChange}
                  placeholder="0"
                  placeholderTextColor="#6b7280"
                  keyboardType="decimal-pad"
                  onFocus={() => setIsAmountFocused(true)}
                  onBlur={() => setIsAmountFocused(false)}
                  className="flex-1 text-white text-5xl font-semibold text-right pr-3"
                  style={{ minWidth: 120 }}
                />
                <Text className="text-gray-400 text-3xl mb-1 w-16 text-right">
                  {amountMode === 'token' ? selectedToken?.symbol : 'USD'}
                </Text>
              </View>
              <Text className="text-gray-500 text-sm mt-2 text-center">
                {getConversionText()}
              </Text>
            </View>

            <View className="flex-row justify-between mb-6">
              {[25, 50, 75].map((percent) => (
                <TouchableOpacity
                  key={percent}
                  onPress={() => handlePercent(percent)}
                  className="flex-1 bg-gray-900 rounded-xl py-3 mr-2"
                >
                  <Text className="text-white text-center">{percent}%</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                onPress={handleMax}
                className="flex-1 bg-gray-900 rounded-xl py-3"
              >
                <Text className="text-white text-center">Max</Text>
              </TouchableOpacity>
            </View>

            {isTonNetwork && (
              <View className="mb-6">
                {!noteExpanded && !comment ? (
                  <TouchableOpacity
                    onPress={() => setNoteExpanded(true)}
                    className="bg-gray-900 rounded-xl px-4 py-4"
                  >
                    <Text className="text-gray-400">Add note</Text>
                  </TouchableOpacity>
                ) : (
                  <TextInput
                    value={comment}
                    onChangeText={setComment}
                    placeholder="Add a note (optional)"
                    placeholderTextColor="#6b7280"
                    className="bg-gray-900 rounded-xl px-4 py-4 text-white"
                    multiline
                    onBlur={() => {
                      if (!comment.trim()) {
                        setNoteExpanded(false);
                      }
                    }}
                  />
                )}
              </View>
            )}
          </KeyboardAwareScrollView>
        )}

        {step === 'enter-amount' && (
          <View
            className="absolute left-0 right-0 px-5"
            style={{ bottom: footerOffset }}
          >
            <View className="bg-gray-950/95 border border-gray-800 rounded-2xl p-3">
              <View className="flex-row items-center justify-between mb-3">
                <Text className="text-gray-400 text-sm">Estimated Fee</Text>
                {gasEstimate?.error && (
                  <TouchableOpacity onPress={estimateGas}>
                    <Text className="text-purple-400 text-xs">Retry</Text>
                  </TouchableOpacity>
                )}
              </View>
              {isEstimating && (
                <View className="flex-row items-center mb-3">
                  <ActivityIndicator size="small" color="#a855f7" />
                  <Text className="text-gray-400 ml-2">Estimating gas...</Text>
                </View>
              )}
              {!isEstimating && (
                <Text className="text-white font-medium mb-3">
                  {gasEstimate?.error
                    ? 'Unable to estimate'
                    : gasEstimate
                      ? (isTonNetwork && parseFloat(gasEstimate.estimatedCostNative) === 0)
                        ? 'Calculating...'
                        : `${formatTokenAmountDisplay(
                          gasEstimate.estimatedCostNative || '0',
                          getDisplayDecimals()
                        )} ${gasEstimate.nativeSymbol}`
                      : 'Enter amount to estimate fees'}
                </Text>
              )}
              <TouchableOpacity
                onPress={handleAmountContinue}
                disabled={!amount}
                className={`rounded-xl py-4 ${
                  amount ? 'bg-purple-600' : 'bg-gray-800'
                }`}
              >
                <Text className="text-white font-semibold text-center text-lg">
                  Continue
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Step: Confirm */}
        {step === 'confirm' && (
          <View className="flex-1 px-5 pt-6">
            <View className="flex-1">
              <View className="bg-gray-900 rounded-3xl p-6 mb-5">
                <Text className="text-gray-400 text-center text-sm mb-3">You are sending</Text>
                <Text className="text-white text-5xl font-bold text-center">
                  {getUsdConversionText() || 'Price unavailable'}
                </Text>
                <Text className="text-gray-500 text-center mt-2">
                  {formatTokenAmountDisplay(amount, getDisplayDecimals())} {selectedToken?.symbol}
                </Text>
              </View>

              <View className="bg-gray-900 rounded-2xl p-5 mb-4">
                <View className="flex-row items-center justify-between mb-3">
                  <Text className="text-gray-400 text-xs uppercase tracking-widest">
                    Recipient
                  </Text>
                  <TouchableOpacity onPress={() => setStep('select-recipient')}>
                    <Text className="text-purple-400 text-xs">Edit</Text>
                  </TouchableOpacity>
                </View>
                <Text className="text-white text-lg font-semibold mb-2">
                  {recipient}
                </Text>
                <Text className="text-gray-500 text-sm">
                  {networkConfig?.name || network}
                </Text>
              </View>

              <View className="bg-gray-900 rounded-2xl p-5">
                <View className="flex-row items-center justify-between mb-3">
                  <Text className="text-gray-400 text-xs uppercase tracking-widest">
                    Details
                  </Text>
                  <TouchableOpacity onPress={() => setStep('enter-amount')}>
                    <Text className="text-purple-400 text-xs">Edit</Text>
                  </TouchableOpacity>
                </View>
                {isXRPNetwork && destinationTag && (
                  <DetailRow label="Destination Tag" value={destinationTag} />
                )}
                {isTonNetwork && comment && (
                  <DetailRow label="Note" value={comment} />
                )}
                {gasEstimate && (
                  <DetailRow
                    label="Network Fee"
                    value={gasEstimate.error
                      ? 'Unable to estimate'
                      : `${formatTokenAmountDisplay(
                        gasEstimate.estimatedCostNative || '0',
                        getDisplayDecimals()
                      )} ${gasEstimate.nativeSymbol}`}
                  />
                )}
              </View>
            </View>

            <View className="flex-row gap-3 pb-5">
              <TouchableOpacity
                onPress={() => setStep('enter-amount')}
                className="flex-1 bg-gray-800 rounded-xl py-4"
              >
                <Text className="text-white font-semibold text-center">Back</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSend}
                disabled={isSending}
                className="flex-1 bg-purple-600 rounded-xl py-4"
              >
                {isSending ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text className="text-white font-semibold text-center">Send</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* QR Scanner Modal */}
        <Modal
          visible={showScanner}
          animationType="slide"
          onRequestClose={closeScanner}
        >
          <SafeAreaView className="flex-1 bg-black">
            <View className="flex-1 relative">
              {permission?.granted ? (
                <CameraView
                  style={StyleSheet.absoluteFillObject}
                  facing="back"
                  barcodeScannerSettings={{
                    barcodeTypes: ['qr'],
                  }}
                  onBarcodeScanned={scanStatus === 'idle' ? handleBarCodeScanned : undefined}
                />
              ) : (
                <View className="flex-1 items-center justify-center px-8">
                  <Ionicons name="camera-outline" size={48} color="#9ca3af" />
                  <Text className="text-white text-lg font-semibold mt-4 text-center">
                    Camera access needed
                  </Text>
                  <Text className="text-gray-400 text-center mt-2">
                    Enable camera access to scan a wallet QR code.
                  </Text>
                  <TouchableOpacity
                    onPress={requestPermission}
                    className="bg-purple-600 rounded-xl px-5 py-3 mt-6"
                  >
                    <Text className="text-white font-semibold">Enable Camera</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Scanner overlay */}
              <View className="flex-1 items-center justify-center">
                <View className="w-64 h-64 border-2 border-white/50 rounded-3xl">
                  <View className="absolute -top-1 -left-1 w-8 h-8 border-t-4 border-l-4 border-purple-500 rounded-tl-xl" />
                  <View className="absolute -top-1 -right-1 w-8 h-8 border-t-4 border-r-4 border-purple-500 rounded-tr-xl" />
                  <View className="absolute -bottom-1 -left-1 w-8 h-8 border-b-4 border-l-4 border-purple-500 rounded-bl-xl" />
                  <View className="absolute -bottom-1 -right-1 w-8 h-8 border-b-4 border-r-4 border-purple-500 rounded-br-xl" />
                </View>
              </View>

              <View className="absolute bottom-8 left-0 right-0 px-6">
                <View className="bg-gray-900/90 border border-gray-800 rounded-2xl px-4 py-4">
                  <View className="flex-row items-center justify-between mb-2">
                    <Text className="text-white font-semibold">Scan QR code</Text>
                    <TouchableOpacity
                      onPress={closeScanner}
                      className="w-8 h-8 items-center justify-center rounded-full bg-gray-800"
                      accessibilityLabel="Close scanner"
                    >
                      <Ionicons name="close" size={16} color="#d1d5db" />
                    </TouchableOpacity>
                  </View>
                  {scanStatus === 'idle' && (
                    <>
                      <Text className="text-white text-center font-semibold">
                        Align the QR code inside the frame
                      </Text>
                      <Text className="text-gray-400 text-center text-xs mt-2">
                        Scans will auto-fill the recipient address
                      </Text>
                    </>
                  )}

                  {scanStatus === 'scanned' && (
                    <>
                      <View className="items-center">
                        <Ionicons name="checkmark-circle" size={28} color="#34d399" />
                        <Text className="text-white text-center font-semibold mt-2">
                          QR code detected
                        </Text>
                        <Text className="text-gray-400 text-center text-xs mt-1">
                          {`${scannedAddress.slice(0, 10)}...${scannedAddress.slice(-6)}`}
                        </Text>
                        {scannedMeta?.amount && (
                          <Text className="text-gray-400 text-center text-xs mt-1">
                            Amount: {scannedMeta.amount}
                          </Text>
                        )}
                        {scannedMeta?.destinationTag && isXRPNetwork && (
                          <Text className="text-gray-400 text-center text-xs mt-1">
                            Destination Tag: {scannedMeta.destinationTag}
                          </Text>
                        )}
                      </View>
                    </>
                  )}

                  {scanStatus === 'copied' && (
                    <View className="items-center">
                      <Ionicons name="checkmark-done" size={28} color="#34d399" />
                      <Text className="text-white text-center font-semibold mt-2">
                        Copied to clipboard
                      </Text>
                      <Text className="text-gray-400 text-center text-xs mt-1">
                        Returning to Send
                      </Text>
                    </View>
                  )}

                  {scanStatus === 'error' && (
                    <>
                      <Text className="text-white text-center font-semibold">
                        Scan failed
                      </Text>
                      <Text className="text-gray-400 text-center text-xs mt-2">
                        {scanError}
                      </Text>
                    </>
                  )}
                </View>
              </View>
            </View>
          </SafeAreaView>
        </Modal>
      </View>
    </SafeAreaView>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <View className="flex-row justify-between py-3 border-b border-gray-800">
      <Text className="text-gray-400">{label}</Text>
      <Text
        className="text-white font-medium text-right max-w-[60%]"
        numberOfLines={1}
        ellipsizeMode="tail"
      >
        {value}
      </Text>
    </View>
  );
}
