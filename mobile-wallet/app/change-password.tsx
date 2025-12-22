/**
 * @fileoverview Change password screen.
 */

import { useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Alert } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useWalletStore } from '../store';
import { useBiometrics } from '../hooks';

export default function ChangePasswordScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const biometrics = useBiometrics();
  const changePassword = useWalletStore((state) => state.changePassword);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPasswords, setShowPasswords] = useState(false);

  const isValid =
    currentPassword.length > 0 &&
    newPassword.length >= 8 &&
    newPassword === confirmPassword;

  const handleSave = async () => {
    if (!isValid || isLoading) return;
    if (currentPassword === newPassword) {
      Alert.alert('Error', 'New password must be different from the current password.');
      return;
    }

    setIsLoading(true);
    try {
      await changePassword(currentPassword, newPassword);

      if (biometrics.isEnabled && biometrics.isAvailable) {
        await biometrics.enable(newPassword);
      }

      Alert.alert('Success', 'Your password has been updated.');
      router.back();
    } catch (error) {
      Alert.alert('Error', error instanceof Error ? error.message : 'Failed to change password.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-950">
      {/* Header */}
      <View
        className="flex-row items-center px-5 pb-4 border-b border-gray-800"
        style={{ paddingTop: insets.top + 8 }}
      >
        <TouchableOpacity onPress={() => router.back()} className="p-2 -ml-2">
          <Ionicons name="arrow-back" size={24} color="white" />
        </TouchableOpacity>
        <Text className="text-white text-xl font-bold ml-2">Change Password</Text>
      </View>

      <View className="flex-1 px-6 pt-6">
        <Text className="text-gray-400 mb-6">
          Your password encrypts your wallet on this device. Keep it secure and do not share it.
        </Text>

        <View className="mb-4">
          <Text className="text-white mb-2">Current Password</Text>
          <TextInput
            value={currentPassword}
            onChangeText={setCurrentPassword}
            placeholder="Enter current password"
            placeholderTextColor="#6b7280"
            secureTextEntry={!showPasswords}
            autoCapitalize="none"
            className="bg-gray-900 rounded-xl px-4 py-4 text-white"
          />
        </View>

        <View className="mb-4">
          <Text className="text-white mb-2">New Password</Text>
          <TextInput
            value={newPassword}
            onChangeText={setNewPassword}
            placeholder="Create a new password"
            placeholderTextColor="#6b7280"
            secureTextEntry={!showPasswords}
            autoCapitalize="none"
            className="bg-gray-900 rounded-xl px-4 py-4 text-white"
          />
          {newPassword.length > 0 && newPassword.length < 8 && (
            <Text className="text-red-400 text-xs mt-2">
              Password must be at least 8 characters
            </Text>
          )}
        </View>

        <View className="mb-4">
          <Text className="text-white mb-2">Confirm New Password</Text>
          <TextInput
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            placeholder="Re-enter new password"
            placeholderTextColor="#6b7280"
            secureTextEntry={!showPasswords}
            autoCapitalize="none"
            className="bg-gray-900 rounded-xl px-4 py-4 text-white"
          />
          {confirmPassword.length > 0 && confirmPassword !== newPassword && (
            <Text className="text-red-400 text-xs mt-2">Passwords do not match</Text>
          )}
        </View>

        <TouchableOpacity
          onPress={() => setShowPasswords(!showPasswords)}
          className="flex-row items-center mb-8"
        >
          <Ionicons
            name={showPasswords ? 'eye-off-outline' : 'eye-outline'}
            size={18}
            color="#9ca3af"
          />
          <Text className="text-gray-400 ml-2">
            {showPasswords ? 'Hide passwords' : 'Show passwords'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleSave}
          disabled={!isValid || isLoading}
          className={`rounded-xl py-4 ${
            isValid && !isLoading ? 'bg-purple-600' : 'bg-gray-800'
          }`}
        >
          <Text className="text-white font-semibold text-center text-lg">
            {isLoading ? 'Updating...' : 'Update Password'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
