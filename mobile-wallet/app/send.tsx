/**
 * @fileoverview Send transaction modal.
 */

import { useState, useEffect, useCallback } from 'react';
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
  Linking,
  ToastAndroid,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useSendScreenSelector } from '../store';
import type { Token, GasEstimate } from '../services';
import { isValidTonAddress } from '../services';
import * as Clipboard from 'expo-clipboard';
import { KeyboardAwareScrollView } from '../components/KeyboardAwareScrollView';

export default function SendScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    balances,
    network,
    networks,
    getGasEstimate,
    sendTransaction,
  } = useSendScreenSelector();

  const [selectedToken, setSelectedToken] = useState<Token | null>(null);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [gasEstimate, setGasEstimate] = useState<GasEstimate | null>(null);
  const [isEstimating, setIsEstimating] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [step, setStep] = useState<'select-token' | 'enter-details' | 'confirm'>('select-token');
  const [showResultModal, setShowResultModal] = useState(false);
  const [txResult, setTxResult] = useState<{ hash?: string; status: 'pending' | 'confirmed' } | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

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

  const networkConfig = networks[network];
  const isXRPNetwork = networkConfig?.type === 'xrp';
  const isTonNetwork = networkConfig?.type === 'ton';
  const footerHeight = 132;
  const footerOffset =
    keyboardHeight > 0 ? Math.max(keyboardHeight - insets.bottom, 0) : insets.bottom;

  // Set default token on mount
  useEffect(() => {
    if (balances.length > 0 && !selectedToken) {
      setSelectedToken(balances[0].token);
      setStep('enter-details');
    }
  }, [balances]);

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

  // Estimate gas when amount and recipient are valid
  const estimateGas = useCallback(async () => {
    if (!selectedToken || !recipient || !amount) return;

    // Basic validation
    if (recipient.length < 10) return;
    if (!isValidAmountInput(amount)) return;
    if (parseFloat(amount) <= 0) return;

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
    setStep('enter-details');
  };

  // Handle QR code scanning
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
      setAmount(normalizeAmountInput(scannedAmount));
    }
    try {
      await Clipboard.setStringAsync(address);
      setScanStatus('copied');
    } catch (error) {
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

  const handleContinue = () => {
    if (!selectedToken || !recipient || !amount) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }
    if (!isValidAmountInput(amount) || parseFloat(amount) <= 0) {
      Alert.alert('Error', 'Please enter a valid amount');
      return;
    }
    // Validate TON address format
    if (isTonNetwork && !isValidTonAddress(recipient)) {
      Alert.alert(
        'Invalid Address',
        'Please enter a valid TON address (e.g., EQ... or UQ... format)'
      );
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

      setTxResult({ hash: result.hash, status: result.status });
      setShowResultModal(true);
    } catch (error) {
      Alert.alert('Transaction Failed', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setIsSending(false);
    }
  };

  const showToast = useCallback((message: string) => {
    if (Platform.OS === 'android') {
      ToastAndroid.show(message, ToastAndroid.SHORT);
      return;
    }
    setToastMessage(message);
    setTimeout(() => setToastMessage(null), 2000);
  }, []);

  const getTokenBalance = (symbol: string) => {
    const item = balances.find((b) => b.token.symbol === symbol);
    return item?.balance || '0';
  };

  const handleMax = () => {
    if (selectedToken) {
      const balance = getTokenBalance(selectedToken.symbol);
      setAmount(balance);
    }
  };

  const normalizeAmountInput = (value: string) => {
    let sanitized = value.replace(/[^0-9.]/g, '');
    const firstDot = sanitized.indexOf('.');
    if (firstDot !== -1) {
      sanitized =
        sanitized.slice(0, firstDot + 1) +
        sanitized.slice(firstDot + 1).replace(/\./g, '');
    }
    if (sanitized.startsWith('.')) {
      sanitized = `0${sanitized}`;
    }
    return sanitized;
  };

  const isValidAmountInput = (value: string) => /^\d+(\.\d+)?$/.test(value);

  return (
    <SafeAreaView className="flex-1 bg-gray-950">
      <View className="flex-1">
        {/* Header */}
        <View className="flex-row items-center justify-between px-5 pt-4 pb-4 border-b border-gray-800">
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="close" size={28} color="white" />
          </TouchableOpacity>
          <Text className="text-white text-xl font-bold">Send</Text>
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

        {/* Step: Enter Details */}
        {step === 'enter-details' && (
          <KeyboardAwareScrollView
            className="flex-1 px-5 pt-4"
            extraBottomPadding={footerHeight + 16}
          >
            {/* Selected Token */}
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

            {/* Recipient */}
            <View className="mb-4">
              <Text className="text-white mb-2">Recipient Address</Text>
              <View className="flex-row bg-gray-900 rounded-xl items-center">
                <TextInput
                  value={recipient}
                  onChangeText={setRecipient}
                  placeholder={
                    isXRPNetwork ? 'rAddress...' :
                    isTonNetwork ? 'EQ... or UQ...' :
                    '0x... or ENS name'
                  }
                  placeholderTextColor="#6b7280"
                  autoCapitalize="none"
                  autoCorrect={false}
                  className="flex-1 px-4 py-4 text-white font-mono"
                />
                <TouchableOpacity
                  onPress={handleOpenScanner}
                  className="px-4 py-4"
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
                    // Only allow numeric input
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

            {/* TON Comment */}
            {isTonNetwork && (
              <View className="mb-4">
                <View className="flex-row justify-between items-center mb-2">
                  <Text className="text-white">Comment</Text>
                  <Text className="text-gray-500 text-sm">(Optional)</Text>
                </View>
                <TextInput
                  value={comment}
                  onChangeText={setComment}
                  placeholder="Enter comment (optional)"
                  placeholderTextColor="#6b7280"
                  className="bg-gray-900 rounded-xl px-4 py-4 text-white"
                />
                <Text className="text-gray-500 text-xs mt-1">
                  Optional message attached to the transaction
                </Text>
              </View>
            )}

            {/* Amount */}
            <View className="mb-4">
              <View className="flex-row justify-between items-center mb-2">
                <Text className="text-white">Amount</Text>
                <TouchableOpacity onPress={handleMax}>
                  <Text className="text-purple-400 text-sm">Max</Text>
                </TouchableOpacity>
              </View>
              <View className="flex-row bg-gray-900 rounded-xl items-center">
                <TextInput
                  value={amount}
                  onChangeText={(value) => setAmount(normalizeAmountInput(value))}
                  placeholder="0.0"
                  placeholderTextColor="#6b7280"
                  keyboardType="decimal-pad"
                  className="flex-1 px-4 py-4 text-white text-xl"
                />
                <Text className="text-gray-400 px-4">{selectedToken?.symbol}</Text>
              </View>
            </View>

          </KeyboardAwareScrollView>
        )}

        {step === 'enter-details' && (
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
                        : `${gasEstimate.estimatedCostNative} ${gasEstimate.nativeSymbol}`
                      : 'Enter amount to estimate fees'}
                </Text>
              )}
              <TouchableOpacity
                onPress={handleContinue}
                disabled={!recipient || !amount}
                className={`rounded-xl py-4 ${
                  recipient && amount ? 'bg-purple-600' : 'bg-gray-800'
                }`}
              >
                <Text className="text-white font-semibold text-center text-lg">
                  Review Transaction
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
                  {amount} {selectedToken?.symbol}
                </Text>
                <Text className="text-gray-500 text-center mt-2">
                  Estimated value unavailable
                </Text>
              </View>

              <View className="bg-gray-900 rounded-2xl p-5 mb-4">
                <Text className="text-gray-400 text-xs uppercase tracking-widest mb-3">
                  Recipient
                </Text>
                <Text className="text-white text-lg font-semibold mb-2">
                  {recipient}
                </Text>
                <Text className="text-gray-500 text-sm">
                  {networkConfig?.name || network}
                </Text>
              </View>

              <View className="bg-gray-900 rounded-2xl p-5">
                <Text className="text-gray-400 text-xs uppercase tracking-widest mb-3">
                  Details
                </Text>
                {isXRPNetwork && destinationTag && (
                  <DetailRow label="Destination Tag" value={destinationTag} />
                )}
                {isTonNetwork && comment && (
                  <DetailRow label="Comment" value={comment} />
                )}
                {gasEstimate && (
                  <DetailRow
                    label="Network Fee"
                    value={gasEstimate.error
                      ? 'Unable to estimate'
                      : `${gasEstimate.estimatedCostNative} ${gasEstimate.nativeSymbol}`}
                  />
                )}
              </View>
            </View>

            <View className="flex-row gap-3 pb-5">
              <TouchableOpacity
                onPress={() => setStep('enter-details')}
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
                  <Text className="text-white font-semibold text-center">Confirm</Text>
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

      <Modal
        visible={showResultModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowResultModal(false)}
      >
        <View className="flex-1 items-center justify-center bg-black/60 px-6">
          <View className="bg-gray-900 rounded-2xl p-6 w-full">
            <View className="items-center mb-4">
              <View className="w-14 h-14 rounded-full items-center justify-center bg-emerald-500/20 mb-3">
                <Ionicons name="checkmark" size={28} color="#34d399" />
              </View>
              <Text className="text-white text-xl font-bold">Transaction Broadcasted</Text>
              <Text className="text-gray-400 mt-1">Pending confirmation</Text>
            </View>

            <View className="bg-gray-950 rounded-xl p-4 mb-4">
              <DetailRow label="Amount" value={`${amount} ${selectedToken?.symbol || ''}`} />
              <DetailRow
                label="To"
                value={`${recipient.slice(0, 10)}...${recipient.slice(-8)}`}
                copyValue={recipient}
                onCopy={showToast}
              />
              <DetailRow label="Network" value={networkConfig?.name || network} />
              {gasEstimate && (
                <DetailRow
                  label="Network Fee"
                  value={gasEstimate.error
                    ? 'Unable to estimate'
                    : `${gasEstimate.estimatedCostNative} ${gasEstimate.nativeSymbol}`}
                />
              )}
              <DetailRow
                label="Hash"
                value={txResult?.hash
                  ? `${txResult.hash.slice(0, 10)}...${txResult.hash.slice(-8)}`
                  : 'Pending'}
                copyValue={txResult?.hash}
                onCopy={showToast}
                isLast
              />
            </View>

            {networkConfig?.blockExplorer && (
              <TouchableOpacity
                className={`rounded-xl py-4 items-center mb-3 ${
                  txResult?.hash ? 'bg-gray-800' : 'bg-gray-800/50'
                }`}
                disabled={!txResult?.hash}
                onPress={() => {
                  if (!txResult?.hash) return;
                  const url = `${networkConfig.blockExplorer}/tx/${txResult.hash}`;
                  Linking.openURL(url).catch((error) => {
                    console.error('Failed to open explorer URL:', error);
                  });
                }}
              >
                <Text className="text-white font-semibold">
                  {txResult?.hash ? 'View in Explorer' : 'View in Explorer (pending)'}
                </Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              className="bg-purple-600 rounded-xl py-4 items-center"
              onPress={() => {
                setShowResultModal(false);
                router.back();
              }}
            >
              <Text className="text-white font-semibold">Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {toastMessage && (
        <View className="absolute bottom-10 left-6 right-6 items-center">
          <View className="bg-gray-800 rounded-full px-4 py-2">
            <Text className="text-white text-sm">{toastMessage}</Text>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

function DetailRow({
  label,
  value,
  copyValue,
  onCopy,
  isLast,
}: {
  label: string;
  value: string;
  copyValue?: string;
  onCopy?: (message: string) => void;
  isLast?: boolean;
}) {
  return (
    <View className={`flex-row justify-between py-3 ${isLast ? '' : 'border-b border-gray-800'}`}>
      <Text className="text-gray-400">{label}</Text>
      <View className="flex-row items-center">
        <Text className="text-white font-medium">{value}</Text>
        {copyValue && (
          <TouchableOpacity
            onPress={async () => {
              await Clipboard.setStringAsync(copyValue);
              onCopy?.(`${label} copied to clipboard`);
            }}
            className="ml-2"
          >
            <Ionicons name="copy-outline" size={16} color="#9ca3af" />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}
