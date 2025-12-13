/**
 * @fileoverview Bitcoin transaction building and signing (P2WPKH / BIP-84).
 *
 * Phase 3: Sending BTC.
 *
 * This module is deliberately small-scope:
 * - P2WPKH only (Native SegWit)
 * - Largest-first UTXO selection
 * - Change sent back to a provided change address (initially same as from)
 *
 * Designed to run in both Node and browser/extension builds.
 */

import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { ECPairFactory } from 'ecpair';
import type { UTXO } from './types.js';

bitcoin.initEccLib(ecc);
const ECPair = ECPairFactory(ecc);

export interface FeeEstimation {
  feeRateSatVb: number;
  vbytes: number;
  feeSats: number;
  inputCount: number;
  outputCount: number;
  hasChange: boolean;
}

export interface SelectedInputs {
  inputs: UTXO[];
  totalInputSats: number;
  changeSats: number;
  fee: FeeEstimation;
}

export interface PrevoutInfo {
  txid: string;
  vout: number;
  value: number;
  scriptPubKeyHex: string;
}

export interface BuildAndSignParams {
  network: 'mainnet' | 'testnet';
  wif: string;
  toAddress: string;
  amountSats: number;
  changeAddress: string;
  changeSats: number;
  feeRateSatVb: number;
  feeSats: number;
  prevouts: PrevoutInfo[];
}

const P2WPKH_INPUT_VBYTES = 68;
const P2WPKH_OUTPUT_VBYTES = 31;
const TX_OVERHEAD_VBYTES = 10;
const DUST_LIMIT_SATS = 546;

function toNetwork(network: 'mainnet' | 'testnet'): bitcoin.networks.Network {
  return network === 'mainnet' ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;
}

export function estimateVbytesP2wpkh(inputCount: number, outputCount: number): number {
  return TX_OVERHEAD_VBYTES + inputCount * P2WPKH_INPUT_VBYTES + outputCount * P2WPKH_OUTPUT_VBYTES;
}

export function parseBtcToSatoshisExact(btc: string): number {
  const trimmed = (btc || '').trim();
  if (!trimmed) return 0;

  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error('Invalid BTC amount');
  }

  const [whole, fracRaw = ''] = trimmed.split('.');
  if (fracRaw.length > 8) {
    throw new Error('BTC amount supports up to 8 decimals');
  }

  const frac = fracRaw.padEnd(8, '0');
  const satsStr = `${whole}${frac}`.replace(/^0+/, '') || '0';
  const sats = BigInt(satsStr);
  if (sats > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('BTC amount too large');
  }
  return Number(sats);
}

export function selectUtxosLargestFirst(
  utxos: UTXO[],
  amountSats: number,
  feeRateSatVb: number
): SelectedInputs {
  if (amountSats <= 0) {
    throw new Error('Amount must be greater than 0');
  }
  if (feeRateSatVb <= 0) {
    throw new Error('Fee rate must be greater than 0');
  }

  const sorted = [...utxos].sort((a, b) => b.value - a.value);

  const selected: UTXO[] = [];
  let total = 0;
  let feeSats = 0;
  let outputCount = 2;

  for (const utxo of sorted) {
    selected.push(utxo);
    total += utxo.value;

    // Assume change output initially; we'll drop it if below dust.
    const vbytes = estimateVbytesP2wpkh(selected.length, outputCount);
    feeSats = Math.ceil(vbytes * feeRateSatVb);

    if (total >= amountSats + feeSats) {
      // Decide whether change is worth creating.
      const changeWithTwoOutputs = total - amountSats - feeSats;
      if (changeWithTwoOutputs < DUST_LIMIT_SATS) {
        outputCount = 1;
        const vbytesNoChange = estimateVbytesP2wpkh(selected.length, outputCount);
        feeSats = Math.ceil(vbytesNoChange * feeRateSatVb);
      }

      const vbytesFinal = estimateVbytesP2wpkh(selected.length, outputCount);
      const change = total - amountSats - feeSats;
      if (change < 0) {
        continue;
      }
      return {
        inputs: selected,
        totalInputSats: total,
        changeSats: outputCount === 2 ? change : 0,
        fee: {
          feeRateSatVb,
          vbytes: vbytesFinal,
          feeSats,
          inputCount: selected.length,
          outputCount,
          hasChange: outputCount === 2 && change >= DUST_LIMIT_SATS
        }
      };
    }
  }

  throw new Error('Insufficient BTC balance for amount + fee');
}

export function buildAndSignP2wpkhTransaction(params: BuildAndSignParams): { txHex: string; txid: string } {
  const btcNetwork = toNetwork(params.network);
  const keyPair = ECPair.fromWIF(params.wif, btcNetwork);

  const psbt = new bitcoin.Psbt({ network: btcNetwork });

  for (const input of params.prevouts) {
    psbt.addInput({
      hash: input.txid,
      index: input.vout,
      witnessUtxo: {
        script: Buffer.from(input.scriptPubKeyHex, 'hex'),
        // bitcoinjs-lib v7 expects bigint; v6 accepts number. Use bigint to be safe.
        value: BigInt(input.value)
      } as any
    });
  }

  const totalInput = params.prevouts.reduce((sum, p) => sum + p.value, 0);
  const computedFee = totalInput - params.amountSats - params.changeSats;
  if (computedFee < 0) {
    throw new Error('Insufficient inputs for amount + fee');
  }
  if (params.changeSats > 0) {
    if (params.feeSats !== computedFee) {
      throw new Error('Fee mismatch between estimation and outputs');
    }
  } else {
    // If we omitted change (dust), the remainder becomes additional fee.
    // Guard against accidentally overpaying by a large amount.
    if (computedFee < params.feeSats) {
      throw new Error('Computed fee is less than estimated fee');
    }
    if (computedFee - params.feeSats >= DUST_LIMIT_SATS) {
      throw new Error('Unexpectedly large extra fee (change omitted)');
    }
  }

  psbt.addOutput({
    address: params.toAddress,
    value: BigInt(params.amountSats) as any
  });

  if (params.changeSats >= DUST_LIMIT_SATS) {
    psbt.addOutput({
      address: params.changeAddress,
      value: BigInt(params.changeSats) as any
    });
  }

  psbt.signAllInputs(keyPair as any);
  psbt.finalizeAllInputs();

  const tx = psbt.extractTransaction();
  return { txHex: tx.toHex(), txid: tx.getId() };
}
