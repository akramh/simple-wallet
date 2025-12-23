/**
 * @fileoverview Third-party licenses screen.
 */

import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { TouchableOpacity } from 'react-native';
import { safeGoBack } from '../utils/navigation';

export default function LicensesScreen() {
  const router = useRouter();

  return (
    <SafeAreaView className="flex-1 bg-gray-950">
      {/* Header */}
      <View className="px-5 pt-4 pb-4 flex-row items-center border-b border-gray-800">
        <TouchableOpacity onPress={() => safeGoBack(router)} className="mr-4">
          <Ionicons name="arrow-back" size={24} color="white" />
        </TouchableOpacity>
        <Text className="text-white text-xl font-bold">Open Source Licenses</Text>
      </View>

      <ScrollView className="flex-1 px-5 py-4" showsVerticalScrollIndicator={false}>
        <Text className="text-gray-300 text-sm mb-6">
          This application uses the following open source software components:
        </Text>

        {/* LGPL Notice - Most Important */}
        <LicenseSection
          title="rpc-websockets"
          version="9.3.2"
          license="LGPL-3.0-only"
          author="Elpheria j.d.o.o."
          repository="https://github.com/elpheria/rpc-websockets"
          description="JSON-RPC 2.0 implementation over WebSockets for Node.js and JavaScript/TypeScript"
          licenseText={`Copyright (c) Elpheria j.d.o.o.

rpc-websockets is an Open Source project licensed under the terms of the LGPLv3 license.

This library is free software; you can redistribute it and/or modify it under the terms of the GNU Lesser General Public License as published by the Free Software Foundation; either version 3 of the License, or (at your option) any later version.

This library is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Lesser General Public License for more details.

You should have received a copy of the GNU Lesser General Public License along with this library; if not, see <https://www.gnu.org/licenses/lgpl-3.0.html>.

Note: This package is used as a dependency of @solana/web3.js for WebSocket RPC communication.`}
          isLGPL
        />

        <LicenseSection
          title="@solana/web3.js"
          version="1.98.4"
          license="MIT"
          author="Solana Labs"
          repository="https://github.com/solana-labs/solana-web3.js"
          description="Solana JavaScript SDK for interacting with the Solana blockchain"
        />

        <LicenseSection
          title="ethers"
          version="6.13.1"
          license="MIT"
          author="Richard Moore"
          repository="https://github.com/ethers-io/ethers.js"
          description="Complete Ethereum library for JavaScript"
        />

        <LicenseSection
          title="xrpl"
          version="4.1.0"
          license="ISC"
          author="Ripple Labs"
          repository="https://github.com/XRPLF/xrpl.js"
          description="JavaScript/TypeScript library for XRP Ledger"
        />

        <LicenseSection
          title="React Native"
          version="0.81.5"
          license="MIT"
          author="Meta Platforms, Inc."
          repository="https://github.com/facebook/react-native"
          description="A framework for building native apps using React"
        />

        <LicenseSection
          title="Expo"
          version="~54.0.30"
          license="MIT"
          author="Expo"
          repository="https://github.com/expo/expo"
          description="An open-source platform for making universal native apps"
        />

        <Text className="text-gray-500 text-xs mt-8 mb-4">
          For a complete list of all dependencies and their licenses, please visit our GitHub repository.
        </Text>

        <Text className="text-gray-500 text-xs mb-8">
          All other dependencies are licensed under permissive open source licenses (MIT, Apache-2.0, ISC, BSD).
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function LicenseSection({
  title,
  version,
  license,
  author,
  repository,
  description,
  licenseText,
  isLGPL = false,
}: {
  title: string;
  version: string;
  license: string;
  author: string;
  repository: string;
  description?: string;
  licenseText?: string;
  isLGPL?: boolean;
}) {
  return (
    <View className={`mb-6 p-4 rounded-xl ${isLGPL ? 'bg-yellow-900/20 border border-yellow-700/30' : 'bg-gray-900'}`}>
      {isLGPL && (
        <View className="flex-row items-center mb-2">
          <Ionicons name="warning-outline" size={16} color="#fbbf24" />
          <Text className="text-yellow-500 text-xs font-semibold ml-1">LGPL License</Text>
        </View>
      )}
      <Text className="text-white font-bold text-base">{title}</Text>
      <Text className="text-gray-400 text-sm mt-1">Version: {version}</Text>
      {description && (
        <Text className="text-gray-400 text-sm mt-2">{description}</Text>
      )}
      <View className="mt-3 pt-3 border-t border-gray-800">
        <Text className="text-gray-500 text-xs">License: <Text className="text-purple-400">{license}</Text></Text>
        <Text className="text-gray-500 text-xs mt-1">Author: {author}</Text>
        <Text className="text-gray-500 text-xs mt-1">Repository: {repository}</Text>
      </View>
      {licenseText && (
        <View className="mt-3 p-3 bg-gray-950 rounded-lg">
          <Text className="text-gray-400 text-xs leading-5">{licenseText}</Text>
        </View>
      )}
    </View>
  );
}
