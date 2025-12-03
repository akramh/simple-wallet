import inquirer from 'inquirer';
import { Wallet } from './wallet.js';
import fs from 'fs';
import qrcode from 'qrcode-terminal';
import { ethers } from 'ethers';

const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const wallet = new Wallet(config);

async function main() {
  console.log('=================================');
  console.log('    Simple Crypto Wallet');
  console.log('=================================');
  console.log(`Network: ${config.networks[config.network].name}\n`);

  await wallet.initialize();

  const existingWallets = wallet.getAllWallets();
  const walletNames = Object.keys(existingWallets);

  if (walletNames.length > 0) {
    await selectWalletMenu(existingWallets);
  } else {
    await initialMenu();
  }
}

async function selectWalletMenu(existingWallets) {
  const walletChoices = Object.keys(existingWallets).map(name => {
    const walletData = existingWallets[name];

    // Always derive Account 1's address from mnemonic to ensure consistency
    // Using standard BIP-44 derivation path: m/44'/60'/0'/0/0
    let primaryAddress = 'No accounts';
    if (walletData.mnemonic) {
      try {
        const path = `m/44'/60'/0'/0/0`;
        const hdWallet = ethers.HDNodeWallet.fromPhrase(walletData.mnemonic, "", path);
        primaryAddress = hdWallet.address.toLowerCase();
      } catch (error) {
        primaryAddress = 'Error deriving address';
      }
    }

    const accountCount = walletData.accounts ? Object.keys(walletData.accounts).length : 1;

    return {
      name: `${name} - ${primaryAddress} (${accountCount} account${accountCount !== 1 ? 's' : ''})`,
      value: name
    };
  });

  walletChoices.push({ name: '➕ Add New Wallet', value: 'add_new' });
  walletChoices.push({ name: '❌ Exit', value: 'exit' });

  const { selectedWallet } = await inquirer.prompt([
    {
      type: 'list',
      name: 'selectedWallet',
      message: 'Select a wallet:',
      choices: walletChoices
    }
  ]);

  if (selectedWallet === 'add_new') {
    await initialMenu();
  } else if (selectedWallet === 'exit') {
    console.log('Goodbye!');
    process.exit(0);
  } else {
    const walletData = wallet.loadWallet(selectedWallet);
    if (walletData) {
      console.log(`\n✅ Loaded wallet: ${walletData.address}\n`);
      await mainMenu(selectedWallet);
    } else {
      console.log('\n❌ Failed to load wallet\n');
      await selectWalletMenu(existingWallets);
    }
  }
}

async function initialMenu() {
  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        { name: '🆕 Create New Wallet', value: 'create' },
        { name: '📥 Import Existing Wallet', value: 'import' },
        { name: '⚙️  Change Network', value: 'network' },
        { name: '🔙 Back to Wallet Selection', value: 'back' },
        { name: '❌ Exit', value: 'exit' }
      ]
    }
  ]);

  switch (action) {
    case 'create':
      await createWallet();
      break;
    case 'import':
      await importWallet();
      break;
    case 'network':
      await changeNetwork();
      break;
    case 'back':
      const existingWallets = wallet.getAllWallets();
      if (Object.keys(existingWallets).length > 0) {
        await selectWalletMenu(existingWallets);
      } else {
        console.log('\n⚠️  No saved wallets found\n');
        await initialMenu();
      }
      break;
    case 'exit':
      console.log('Goodbye!');
      process.exit(0);
  }
}

async function createWallet() {
  console.log('\n🔐 Creating new wallet...\n');

  const walletData = wallet.createNewWallet();

  console.log('✅ Wallet created successfully!\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📍 Address:', walletData.address);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('\n🔑 IMPORTANT: Save your mnemonic phrase!');
  console.log('This is the ONLY way to recover your wallet.\n');
  console.log('Mnemonic Phrase:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(walletData.mnemonic);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const answers = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'save',
      message: 'Save wallet to file?',
      default: true
    },
    {
      type: 'input',
      name: 'walletName',
      message: 'Enter a name for this wallet:',
      default: `Wallet_${walletData.address.substring(2, 8)}`,
      when: (answers) => answers.save,
      validate: (input) => {
        if (!input || input.trim().length === 0) {
          return 'Wallet name cannot be empty';
        }
        const existingWallets = wallet.getAllWallets();
        if (existingWallets[input.trim()]) {
          return 'A wallet with this name already exists';
        }
        return true;
      }
    }
  ]);

  let savedWalletName = null;
  if (answers.save) {
    savedWalletName = wallet.saveWallet(answers.walletName.trim());
  }

  await mainMenu(savedWalletName);
}

async function importWallet() {
  console.log('\n📥 Import Wallet\n');

  const { mnemonic } = await inquirer.prompt([
    {
      type: 'input',
      name: 'mnemonic',
      message: 'Enter your 12-word mnemonic phrase:',
      validate: (input) => {
        const words = input.trim().split(/\s+/);
        if (words.length !== 12) {
          return 'Please enter exactly 12 words';
        }
        return true;
      }
    }
  ]);

  try {
    const walletData = wallet.importWallet(mnemonic.trim());
    console.log('\n✅ Wallet imported successfully!');
    console.log('📍 Address:', walletData.address, '\n');

    const answers = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'save',
        message: 'Save wallet to file?',
        default: true
      },
      {
        type: 'input',
        name: 'walletName',
        message: 'Enter a name for this wallet:',
        default: `Wallet_${walletData.address.substring(2, 8)}`,
        when: (answers) => answers.save,
        validate: (input) => {
          if (!input || input.trim().length === 0) {
            return 'Wallet name cannot be empty';
          }
          const existingWallets = wallet.getAllWallets();
          if (existingWallets[input.trim()]) {
            return 'A wallet with this name already exists';
          }
          return true;
        }
      }
    ]);

    let savedWalletName = null;
    if (answers.save) {
      savedWalletName = wallet.saveWallet(answers.walletName.trim());
    }

    await mainMenu(savedWalletName);
  } catch (error) {
    console.log('\n❌ Error:', error.message, '\n');
    await initialMenu();
  }
}

async function mainMenu(currentWalletName) {
  const currentAddress = wallet.getAddress();
  const accountIndex = wallet.currentAccountIndex;

  console.log(`\n💼 Current Account: Account ${accountIndex + 1} (${currentAddress.substring(0, 10)}...)`);

  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        { name: '💰 Check Balance', value: 'balance' },
        { name: '📤 Send Crypto', value: 'send' },
        { name: '📥 Receive (Show Address)', value: 'receive' },
        { name: '👤 Manage Accounts', value: 'accounts' },
        { name: '🔑 Show Private Key & Secret Phrase', value: 'secrets' },
        { name: '⚙️  Change Network', value: 'network' },
        { name: '🔄 Switch Wallet', value: 'switch' },
        { name: '🗑️  Delete Current Wallet', value: 'delete' },
        { name: '❌ Exit', value: 'exit' }
      ]
    }
  ]);

  switch (action) {
    case 'balance':
      await checkBalance(currentWalletName);
      break;
    case 'send':
      await sendCrypto(currentWalletName);
      break;
    case 'receive':
      await showReceiveAddress(currentWalletName);
      break;
    case 'accounts':
      await manageAccounts(currentWalletName);
      break;
    case 'secrets':
      await showWalletSecrets(currentWalletName);
      break;
    case 'network':
      await changeNetwork();
      break;
    case 'switch':
      await switchWallet();
      break;
    case 'delete':
      await deleteCurrentWallet(currentWalletName);
      break;
    case 'exit':
      console.log('Goodbye!');
      process.exit(0);
  }
}

async function checkBalance(currentWalletName) {
  try {
    const address = wallet.getAddress();
    console.log('\n💰 Checking balance...');
    console.log('⏳ Please wait, fetching data from blockchain...\n');

    const balance = await wallet.getBalance();

    console.log('✅ Balance retrieved successfully!\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📍 Address:', address);
    console.log('💵 Balance:', balance, 'ETH');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  } catch (error) {
    console.log('\n❌ Error:', error.message);
    console.log('\n💡 Tip: If requests keep timing out, try changing the network RPC endpoint in config.json\n');
  }

  await mainMenu(currentWalletName);
}

async function sendCrypto(currentWalletName) {
  console.log('\n📤 Send Crypto\n');

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'toAddress',
      message: 'Recipient address:',
      validate: (input) => {
        if (!input.startsWith('0x') || input.length !== 42) {
          return 'Please enter a valid Ethereum address';
        }
        return true;
      }
    },
    {
      type: 'input',
      name: 'amount',
      message: 'Amount (in ETH):',
      validate: (input) => {
        const num = parseFloat(input);
        if (isNaN(num) || num <= 0) {
          return 'Please enter a valid amount';
        }
        return true;
      }
    },
    {
      type: 'confirm',
      name: 'confirm',
      message: (answers) => `Send ${answers.amount} ETH to ${answers.toAddress}?`,
      default: false
    }
  ]);

  if (!answers.confirm) {
    console.log('\n❌ Transaction cancelled\n');
    await mainMenu(currentWalletName);
    return;
  }

  try {
    const receipt = await wallet.sendTransaction(answers.toAddress, answers.amount);
    console.log('\n✅ Transaction confirmed!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 Hash:', receipt.hash);
    console.log('📦 Block:', receipt.blockNumber);
    console.log('⛽ Gas Used:', receipt.gasUsed);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  } catch (error) {
    console.log('\n❌ Transaction failed:', error.message, '\n');
  }

  await mainMenu(currentWalletName);
}

async function showReceiveAddress(currentWalletName) {
  const address = wallet.getAddress();

  console.log('\n📥 Receive Crypto\n');
  console.log('Share this address to receive ETH:\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(address);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('Scan QR Code:\n');
  qrcode.generate(address, { small: true });
  console.log('');

  await mainMenu(currentWalletName);
}

async function showWalletSecrets(currentWalletName) {
  console.log('\n🔑 Wallet Secrets\n');

  const { confirmShow } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmShow',
      message: '⚠️  WARNING: This will display sensitive information. Make sure no one is watching your screen. Continue?',
      default: false
    }
  ]);

  if (!confirmShow) {
    console.log('\n❌ Cancelled\n');
    await mainMenu(currentWalletName);
    return;
  }

  try {
    const address = wallet.getAddress();
    const privateKey = wallet.wallet.privateKey;
    const mnemonic = wallet.mnemonic;

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('⚠️  KEEP THIS INFORMATION SECRET AND SECURE!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('Wallet Name:', currentWalletName || 'Unknown');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📍 Address:');
    console.log(address);
    console.log('\n🔐 Private Key:');
    console.log(privateKey);
    console.log('\n🔑 Secret Phrase (12 words):');
    console.log(mnemonic);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('⚠️  SECURITY REMINDERS:');
    console.log('• Never share your private key or secret phrase with anyone');
    console.log('• Anyone with these can access your funds');
    console.log('• Store them securely offline');
    console.log('• Clear your terminal history if needed\n');

    const { whatNext } = await inquirer.prompt([
      {
        type: 'list',
        name: 'whatNext',
        message: 'What would you like to do?',
        choices: [
          { name: '🔙 Back to Main Menu', value: 'back' },
          { name: '❌ Exit (Clear Screen)', value: 'exit' }
        ]
      }
    ]);

    if (whatNext === 'exit') {
      console.clear();
      console.log('\n✅ Screen cleared. Goodbye!\n');
      process.exit(0);
    } else {
      await mainMenu(currentWalletName);
    }
  } catch (error) {
    console.log('\n❌ Error retrieving wallet secrets:', error.message, '\n');
    await mainMenu(currentWalletName);
  }
}

async function manageAccounts(currentWalletName) {
  console.log('\n👤 Manage Accounts\n');

  const savedAccounts = wallet.getWalletAccounts(currentWalletName);
  const accountChoices = [];

  // Get all account indices and sort them
  const accountIndices = Object.keys(savedAccounts).map(idx => parseInt(idx)).sort((a, b) => a - b);

  // Ensure Account 1 (index 0) always exists
  if (!accountIndices.includes(0)) {
    accountIndices.unshift(0);
  }

  // Show all accounts in sequence
  accountIndices.forEach(index => {
    let address;
    if (savedAccounts[index]) {
      address = savedAccounts[index].address;
    } else {
      // Derive the address for accounts that haven't been saved yet
      address = wallet.getAccountAddress(index);
    }

    const isCurrent = index === wallet.currentAccountIndex;
    accountChoices.push({
      name: `${isCurrent ? '• ' : '  '}Account ${index + 1} - ${address}`,
      value: { action: 'switch', index: index }
    });
  });

  accountChoices.push({ name: '➕ Create New Account', value: { action: 'create' } });
  accountChoices.push({ name: '🔙 Back to Main Menu', value: { action: 'back' } });

  const { selected } = await inquirer.prompt([
    {
      type: 'list',
      name: 'selected',
      message: 'Select an account or action:',
      choices: accountChoices
    }
  ]);

  if (selected.action === 'back') {
    await mainMenu(currentWalletName);
  } else if (selected.action === 'create') {
    try {
      // Find the highest account index and create the next one
      const maxIndex = accountIndices.length > 0 ? Math.max(...accountIndices) : -1;
      const newIndex = maxIndex + 1;

      const newAccount = wallet.switchAccount(newIndex);
      console.log(`\n✅ Created Account ${newIndex + 1}`);
      console.log(`📍 Address: ${newAccount.address}\n`);

      wallet.saveWallet(currentWalletName);
      await mainMenu(currentWalletName);
    } catch (error) {
      console.log(`\n❌ Error creating account: ${error.message}\n`);
      await manageAccounts(currentWalletName);
    }
  } else if (selected.action === 'switch') {
    if (selected.index !== wallet.currentAccountIndex) {
      const switchedAccount = wallet.switchAccount(selected.index);
      console.log(`\n✅ Switched to Account ${selected.index + 1}`);
      console.log(`📍 Address: ${switchedAccount.address}\n`);

      wallet.saveWallet(currentWalletName);
    }
    await mainMenu(currentWalletName);
  }
}

async function changeNetwork() {
  console.log('\n⚙️  Change Network\n');

  const { network } = await inquirer.prompt([
    {
      type: 'list',
      name: 'network',
      message: 'Select network:',
      choices: Object.keys(config.networks).map(key => ({
        name: config.networks[key].name,
        value: key
      }))
    }
  ]);

  config.network = network;
  fs.writeFileSync('config.json', JSON.stringify(config, null, 2));

  console.log(`\n✅ Network changed to ${config.networks[network].name}`);
  console.log('⚠️  Please restart the application for changes to take effect.\n');

  process.exit(0);
}

async function switchWallet() {
  const existingWallets = wallet.getAllWallets();

  if (Object.keys(existingWallets).length > 0) {
    await selectWalletMenu(existingWallets);
  } else {
    console.log('\n⚠️  No other wallets found\n');
    await initialMenu();
  }
}

async function deleteCurrentWallet(currentWalletName) {
  if (!currentWalletName) {
    console.log('\n⚠️  No wallet name specified\n');
    await mainMenu(currentWalletName);
    return;
  }

  const { confirm } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: `Are you sure you want to delete wallet "${currentWalletName}"? This cannot be undone!`,
      default: false
    }
  ]);

  if (confirm) {
    const success = wallet.deleteWallet(currentWalletName);
    if (success) {
      console.log(`\n✅ Wallet "${currentWalletName}" deleted successfully\n`);

      const existingWallets = wallet.getAllWallets();
      if (Object.keys(existingWallets).length > 0) {
        await selectWalletMenu(existingWallets);
      } else {
        console.log('No more wallets available.\n');
        await initialMenu();
      }
    } else {
      console.log('\n❌ Failed to delete wallet\n');
      await mainMenu(currentWalletName);
    }
  } else {
    console.log('\n❌ Deletion cancelled\n');
    await mainMenu(currentWalletName);
  }
}

main().catch(console.error);
