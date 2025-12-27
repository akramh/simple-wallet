/**
 * @fileoverview Token details screen for the extension popup.
 *
 * Provides price history, token metadata, and token-specific activity in a
 * MetaMask/Phantom-inspired layout while reusing existing theme tokens.
 *
 * @responsibilities
 * - Fetch and render token price history and activity
 * - Display token metadata and explorer links
 *
 * @security
 * - Uses explorer and price APIs via background messaging
 * - No secrets handled in UI
 */

import React, { useEffect, useMemo, useState } from 'react';
import type { Token } from '../../../src/types/token.js';
import type { PriceHistoryResult, TimeRange } from '../../../src/price-providers/types.js';
import { useToast } from '../context/ToastContext';
import PriceChart from './PriceChart';
import TokenMetaCard from './TokenMetaCard';
import TokenActivityList from './TokenActivityList';
import { formatUSDValue } from '../../../src/price-service';
import { getTokenPriceKey } from '../utils/tokenFormat';
import backIcon from '../../assets/icons/arrow-left.svg';

interface TokenDetailsScreenProps {
  token: Token;
  tokenIcon?: string | null;
  network: string;
  address: string;
  networks: Record<string, any>;
  tokenPrices: Record<string, number | null>;
  onBack: () => void;
}

interface Transaction {
  hash: string;
  from: string;
  to: string | null;
  value: string;
  fee?: string;
  destinationTag?: number;
  network: string;
  status: 'pending' | 'confirmed' | 'failed';
  type: 'send' | 'receive' | 'contract_interaction';
  timestamp: number;
  blockNumber?: number;
  gasUsed?: string;
  gasPrice?: string;
  tokenSymbol?: string;
  tokenAddress?: string;
  error?: string;
  nonce?: number;
}

/**
 * Token details screen component.
 *
 * @param props - Component props
 * @returns Token details screen
 */
export default function TokenDetailsScreen({
  token,
  tokenIcon,
  network,
  address,
  networks,
  tokenPrices,
  onBack
}: TokenDetailsScreenProps) {
  const { showToast } = useToast();
  const [range, setRange] = useState<TimeRange>('1D');
  const [historyByRange, setHistoryByRange] = useState<Record<string, PriceHistoryResult | null>>({});
  const [historyStatus, setHistoryStatus] = useState<Record<string, 'idle' | 'loading' | 'error'>>({});
  const [dailyChange, setDailyChange] = useState<PriceHistoryResult | null>(null);

  const [activity, setActivity] = useState<Transaction[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [activityRefreshing, setActivityRefreshing] = useState(false);

  const networkConfig = networks[network] || {};
  const priceKey = getTokenPriceKey(token);
  const currentPrice = priceKey ? tokenPrices[priceKey] ?? null : null;

  const ranges: Array<{ label: string; value: TimeRange }> = [
    { label: '1D', value: '1D' },
    { label: '1W', value: '1W' },
    { label: '1M', value: '1M' },
    { label: 'ALL', value: 'ALL' }
  ];

  const selectedHistory = historyByRange[range] || null;
  const isHistoryLoading = historyStatus[range] === 'loading';
  const isHistoryError = historyStatus[range] === 'error';

  const changePercent = dailyChange?.priceChange?.percent;
  const changeLabel =
    typeof changePercent === 'number'
      ? `${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%`
      : '--';

  const changeClass =
    typeof changePercent === 'number'
      ? changePercent >= 0
        ? 'token-details-change positive'
        : 'token-details-change negative'
      : 'token-details-change';

  const latestHistoryPrice = selectedHistory?.data?.length
    ? selectedHistory.data[selectedHistory.data.length - 1].price
    : null;

  const formattedPrice = typeof currentPrice === 'number'
    ? formatUSDValue(currentPrice)
    : typeof latestHistoryPrice === 'number'
      ? formatUSDValue(latestHistoryPrice)
      : '--';

  const hasHistory = Boolean(selectedHistory?.data?.length);

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast('Copied to clipboard');
    } catch {
      showToast('Failed to copy');
    }
  };

  const fetchHistory = async (timeRange: TimeRange) => {
    setHistoryStatus((prev) => ({ ...prev, [timeRange]: 'loading' }));
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_TOKEN_PRICE_HISTORY',
        payload: { symbol: token.symbol, timeRange }
      });
      if (!response || response.error) {
        setHistoryStatus((prev) => ({ ...prev, [timeRange]: 'error' }));
        setHistoryByRange((prev) => ({ ...prev, [timeRange]: null }));
        return;
      }
      setHistoryByRange((prev) => ({ ...prev, [timeRange]: response.result || null }));
      setHistoryStatus((prev) => ({ ...prev, [timeRange]: 'idle' }));
      if (timeRange === '1D') {
        setDailyChange(response.result || null);
      }
    } catch {
      setHistoryStatus((prev) => ({ ...prev, [timeRange]: 'error' }));
    }
  };

  const filterTokenTransactions = (txs: Transaction[]) => {
    const tokenAddress = token.address?.toLowerCase();
    if (token.type === 'native' || token.address === 'native') {
      const symbol = token.symbol.toLowerCase();
      return txs.filter((tx) => !tx.tokenAddress || tx.tokenSymbol?.toLowerCase() === symbol);
    }
    return txs.filter((tx) => tx.tokenAddress?.toLowerCase() === tokenAddress);
  };

  const loadActivity = async (isRefresh = false) => {
    if (isRefresh) {
      setActivityRefreshing(true);
    } else {
      setActivityLoading(true);
    }
    setActivityError(null);
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_EXPLORER_TRANSACTIONS',
        payload: { network, address }
      });
      let transactions: Transaction[] = [];
      if (response && response.supported && !response.error) {
        transactions = response.transactions || [];
      } else {
        const localResponse = await chrome.runtime.sendMessage({
          type: 'GET_TRANSACTIONS_BY_NETWORK',
          payload: { network }
        });
        transactions = localResponse.transactions || [];
      }
      setActivity(filterTokenTransactions(transactions));
    } catch (error: any) {
      setActivityError(error?.message || 'Failed to load activity');
    } finally {
      setActivityLoading(false);
      setActivityRefreshing(false);
    }
  };

  useEffect(() => {
    if (range !== '1D') {
      fetchHistory(range);
    }
  }, [range, token.symbol]);

  useEffect(() => {
    fetchHistory('1D');
  }, [token.symbol]);

  useEffect(() => {
    loadActivity();
  }, [token.symbol, network, address]);

  const tooltipPrice = useMemo(() => {
    if (typeof latestHistoryPrice === 'number') {
      return formatUSDValue(latestHistoryPrice);
    }
    return formattedPrice;
  }, [latestHistoryPrice, formattedPrice]);

  return (
    <div className="takeover token-details-view">
      <button className="back-button" onClick={onBack}>
        <img src={backIcon} alt="Back" />
        <span>Back</span>
      </button>

      <div className="token-details-header">
        <div className="token-details-identity">
          {tokenIcon ? (
            <img src={tokenIcon} alt={token.symbol} className="token-details-icon" />
          ) : (
            <div className="token-details-icon-fallback">{token.symbol.substring(0, 1)}</div>
          )}
          <div>
            <div className="token-details-name">{token.name}</div>
            <div className="token-details-symbol">{token.symbol}</div>
          </div>
        </div>
        <div className="token-details-price">
          <div className="token-details-price-value">{formattedPrice}</div>
          <div className={changeClass}>{changeLabel} (24h)</div>
        </div>
      </div>

      <div className="token-details-card">
        <div className="token-details-chart-header">
          <div className="token-details-chart-title">Price</div>
          <div className="token-details-chart-price">{tooltipPrice}</div>
        </div>
        <div className="price-range-tabs">
          {ranges.map((rangeOption) => (
            <button
              key={rangeOption.value}
              type="button"
              className={`price-range-button ${range === rangeOption.value ? 'active' : ''}`}
              onClick={() => setRange(rangeOption.value)}
            >
              {rangeOption.label}
            </button>
          ))}
        </div>

        {isHistoryLoading && (
          <div className="loading">Loading chart...</div>
        )}
        {isHistoryError && (
          <div className="token-details-error">
            Price data unavailable. <button className="refresh-link" onClick={() => fetchHistory(range)}>Retry</button>
          </div>
        )}
        {!isHistoryLoading && !isHistoryError && !hasHistory && (
          <div className="token-details-empty">No price history available</div>
        )}
        {hasHistory && selectedHistory && (
          <PriceChart data={selectedHistory.data} />
        )}
      </div>

      <TokenMetaCard
        token={token}
        networkName={networkConfig.name || network}
        explorerBaseUrl={networkConfig.blockExplorer || null}
        onCopy={handleCopy}
      />

      <TokenActivityList
        transactions={activity}
        loading={activityLoading}
        error={activityError}
        networkConfig={networkConfig}
        onRefresh={() => loadActivity(true)}
        refreshing={activityRefreshing}
      />
    </div>
  );
}
