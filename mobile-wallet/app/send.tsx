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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useWalletStore } from '../store';
import type { Token, GasEstimate } from '../services';

export default function SendScreen() {
  const router = useRouter();
  const {
    balances,
    network,
    networks,
    getGasEstimate,
    sendTransaction,
  } = useWalletStore();

  const [selectedToken, setSelectedToken] = useState<Token | null>(null);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [gasEstimate, setGasEstimate] = useState<GasEstimate | null>(null);
  const [isEstimating, setIsEstimating] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [step, setStep] = useState<'select-token' | 'enter-details' | 'confirm'>('select-token');

  const networkConfig = networks[network];

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
      const result = await sendTransaction(selectedToken, recipient, amount);

      Alert.alert(
        'Transaction Sent',
        `Transaction hash: ${result.hash.slice(0, 16)}...`,
        [{ text: 'OK', onPress: () => router.back() }]
      );
    } catch (error) {
      Alert.alert('Transaction Failed', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setIsSending(false);
    }
  };

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
              <TextInput
                value={recipient}
                onChangeText={setRecipient}
                placeholder="0x... or ENS name"
                placeholderTextColor="#6b7280"
                autoCapitalize="none"
                autoCorrect={false}
                className="bg-gray-900 rounded-xl px-4 py-4 text-white font-mono"
              />
            </View>

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

            {gasEstimate && !gasEstimate.error && (
              <View className="bg-gray-900 rounded-xl p-4 mb-4">
                <Text className="text-gray-400 text-sm mb-2">Estimated Fee</Text>
                <Text className="text-white font-medium">
                  {gasEstimate.estimatedCostNative} {gasEstimate.nativeSymbol}
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
                {gasEstimate && (
                  <DetailRow
                    label="Network Fee"
                    value={`${gasEstimate.estimatedCostNative} ${gasEstimate.nativeSymbol}`}
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
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between py-3 border-b border-gray-800 last:border-b-0">
      <Text className="text-gray-400">{label}</Text>
      <Text className="text-white font-medium">{value}</Text>
    </View>
  );
}
