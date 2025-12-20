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
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Modal,
  StyleSheet,
  Linking,
  ToastAndroid,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useSendScreenSelector } from '../store';
import type { Token, GasEstimate } from '../services';
import * as Clipboard from 'expo-clipboard';

export default function SendScreen() {
  const router = useRouter();
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

  // QR Scanner state
  const [showScanner, setShowScanner] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [hasScanned, setHasScanned] = useState(false);

  // XRP destination tag state
  const [destinationTag, setDestinationTag] = useState('');

  // TON comment state
  const [comment, setComment] = useState('');

  const networkConfig = networks[network];
  const isXRPNetwork = networkConfig?.type === 'xrp';
  const isTonNetwork = networkConfig?.type === 'ton';

  // Set default token on mount
  useEffect(() => {
    if (balances.length > 0 && !selectedToken) {
      setSelectedToken(balances[0].token);
      setStep('enter-details');
    }
  }, [balances]);

  // Estimate gas when amount and recipient are valid
  const estimateGas = useCallback(async () => {
    if (!selectedToken || !recipient || !amount) return;

    // Basic validation
    if (recipient.length < 10) return;
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
    setShowScanner(true);
  };

  const handleBarCodeScanned = ({ data }: { data: string }) => {
    if (hasScanned) return;
    setHasScanned(true);

    // Parse the scanned data - could be a plain address or a URI
    let address = data;
    let scannedDestinationTag: string | undefined;

    // Handle various URI formats:
    // - ethereum:0x... 
    // - bitcoin:bc1...
    // - solana:...
    // - ripple:rAddress?dt=123 or xrpl:rAddress?dt=123
    if (data.includes(':')) {
      const [scheme, rest] = data.split(':');
      const [addressPart, queryString] = rest.split('?');
      address = addressPart;

      // Parse query parameters for destination tag (XRP)
      if (queryString) {
        const params = new URLSearchParams(queryString);
        const dt = params.get('dt') || params.get('tag') || params.get('destination_tag');
        if (dt) {
          scannedDestinationTag = dt;
        }
        // Also check for amount
        const scannedAmount = params.get('amount');
        if (scannedAmount) {
          setAmount(scannedAmount);
        }
      }
    }

    setRecipient(address);
    if (scannedDestinationTag && isXRPNetwork) {
      setDestinationTag(scannedDestinationTag);
    }
    setShowScanner(false);
  };

  const handleContinue = () => {
    if (!selectedToken || !recipient || !amount) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }
    if (parseFloat(amount) <= 0) {
      Alert.alert('Error', 'Please enter a valid amount');
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

  return (
    <SafeAreaView className="flex-1 bg-gray-950">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1"
      >
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
          <ScrollView className="flex-1 px-5 pt-4">
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
          </ScrollView>
        )}

        {/* Step: Enter Details */}
        {step === 'enter-details' && (
          <ScrollView className="flex-1 px-5 pt-4">
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
                  onChangeText={setAmount}
                  placeholder="0.0"
                  placeholderTextColor="#6b7280"
                  keyboardType="decimal-pad"
                  className="flex-1 px-4 py-4 text-white text-xl"
                />
                <Text className="text-gray-400 px-4">{selectedToken?.symbol}</Text>
              </View>
            </View>

            {/* Gas Estimate */}
            {isEstimating && (
              <View className="flex-row items-center py-2">
                <ActivityIndicator size="small" color="#a855f7" />
                <Text className="text-gray-400 ml-2">Estimating gas...</Text>
              </View>
            )}

            {gasEstimate && (
              <View className="bg-gray-900 rounded-xl p-4 mb-4">
                <Text className="text-gray-400 text-sm mb-2">Estimated Fee</Text>
                <Text className="text-white font-medium">
                  {gasEstimate.error
                    ? 'Unable to estimate'
                    : `${gasEstimate.estimatedCostNative} ${gasEstimate.nativeSymbol}`}
                </Text>
              </View>
            )}

            {/* Continue Button */}
            <TouchableOpacity
              onPress={handleContinue}
              disabled={!recipient || !amount}
              className={`rounded-xl py-4 mt-4 ${
                recipient && amount ? 'bg-purple-600' : 'bg-gray-800'
              }`}
            >
              <Text className="text-white font-semibold text-center text-lg">
                Review Transaction
              </Text>
            </TouchableOpacity>
          </ScrollView>
        )}

        {/* Step: Confirm */}
        {step === 'confirm' && (
          <View className="flex-1 px-5 pt-4">
            <View className="flex-1">
              {/* Summary Card */}
              <View className="bg-gray-900 rounded-2xl p-5 mb-4">
                <Text className="text-gray-400 text-center mb-4">You are sending</Text>
                <Text className="text-white text-4xl font-bold text-center mb-2">
                  {amount} {selectedToken?.symbol}
                </Text>
                <Text className="text-gray-500 text-center">≈ $0.00</Text>
              </View>

              {/* Details */}
              <View className="bg-gray-900 rounded-xl p-4">
                <DetailRow label="To" value={`${recipient.slice(0, 10)}...${recipient.slice(-8)}`} />
                <DetailRow label="Network" value={networkConfig?.name || network} />
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

            {/* Action Buttons */}
            <View className="flex-row gap-3 pb-4">
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
          onRequestClose={() => setShowScanner(false)}
        >
          <SafeAreaView className="flex-1 bg-black">
            <View className="flex-row items-center justify-between px-5 pt-4 pb-4">
              <TouchableOpacity onPress={() => setShowScanner(false)}>
                <Ionicons name="close" size={28} color="white" />
              </TouchableOpacity>
              <Text className="text-white text-xl font-bold">Scan QR Code</Text>
              <View className="w-7" />
            </View>
            
            <View className="flex-1 relative">
              <CameraView
                style={StyleSheet.absoluteFillObject}
                facing="back"
                barcodeScannerSettings={{
                  barcodeTypes: ['qr'],
                }}
                onBarcodeScanned={hasScanned ? undefined : handleBarCodeScanned}
              />
              
              {/* Scanner overlay */}
              <View className="flex-1 items-center justify-center">
                <View className="w-64 h-64 border-2 border-white/50 rounded-3xl">
                  <View className="absolute -top-1 -left-1 w-8 h-8 border-t-4 border-l-4 border-purple-500 rounded-tl-xl" />
                  <View className="absolute -top-1 -right-1 w-8 h-8 border-t-4 border-r-4 border-purple-500 rounded-tr-xl" />
                  <View className="absolute -bottom-1 -left-1 w-8 h-8 border-b-4 border-l-4 border-purple-500 rounded-bl-xl" />
                  <View className="absolute -bottom-1 -right-1 w-8 h-8 border-b-4 border-r-4 border-purple-500 rounded-br-xl" />
                </View>
              </View>
              
              <View className="absolute bottom-10 left-0 right-0 px-10">
                <Text className="text-white text-center text-sm opacity-80">
                  Point your camera at a wallet address QR code
                </Text>
              </View>
            </View>
          </SafeAreaView>
        </Modal>
      </KeyboardAvoidingView>

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
