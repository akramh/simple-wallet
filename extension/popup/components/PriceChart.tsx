/**
 * @fileoverview Lightweight SVG price chart for token details.
 *
 * Renders a simple area/line chart with hover tooltip using existing theme
 * variables and avoids external chart dependencies.
 *
 * @responsibilities
 * - Render price history series as SVG line/area
 * - Show tooltip with price and timestamp on hover
 *
 * @security
 * - No sensitive data handled
 * - Pure rendering component
 */

import React, { useMemo, useRef, useState } from 'react';
import type { PricePoint } from '../../../src/price-providers/types.js';
import { formatUSDValue } from '../../../src/price-service';

interface PriceChartProps {
  data: PricePoint[];
}

/**
 * Price chart component.
 *
 * @param props - Component props
 * @returns Chart component
 */
export default function PriceChart({ data }: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const chartPoints = useMemo(() => {
    if (!data.length) return [];
    const prices = data.map((point) => point.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min || 1;

    return data.map((point, index) => {
      const x = (index / (data.length - 1 || 1)) * 100;
      const y = 100 - ((point.price - min) / range) * 100;
      return { x, y, point };
    });
  }, [data]);

  const { minPrice, maxPrice } = useMemo(() => {
    if (!data.length) return { minPrice: null, maxPrice: null };
    const prices = data.map((point) => point.price);
    return { minPrice: Math.min(...prices), maxPrice: Math.max(...prices) };
  }, [data]);

  const pathD = useMemo(() => {
    if (chartPoints.length === 0) return '';
    const line = chartPoints
      .map((pt, index) => `${index === 0 ? 'M' : 'L'} ${pt.x},${pt.y}`)
      .join(' ');
    const area = `${line} L 100,100 L 0,100 Z`;
    return { line, area };
  }, [chartPoints]);

  const handleMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current || chartPoints.length === 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const percent = Math.max(0, Math.min(1, x / rect.width));
    const index = Math.round(percent * (chartPoints.length - 1));
    setHoverIndex(index);
  };

  const handleLeave = () => setHoverIndex(null);

  const hovered = hoverIndex !== null ? chartPoints[hoverIndex] : null;

  const startLabel = data.length ? new Date(data[0].timestamp).toLocaleDateString() : '';
  const endLabel = data.length ? new Date(data[data.length - 1].timestamp).toLocaleDateString() : '';

  return (
    <div
      className="price-chart"
      ref={containerRef}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
    >
      <div className="price-chart-axis-y">
        <span>{typeof maxPrice === 'number' ? formatUSDValue(maxPrice) : ''}</span>
        <span>{typeof minPrice === 'number' ? formatUSDValue(minPrice) : ''}</span>
      </div>
      <div className="price-chart-axis-x">
        <span>{startLabel}</span>
        <span>{endLabel}</span>
      </div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="price-chart-svg">
        {pathD && (
          <>
            <path d={pathD.area} className="price-chart-area" />
            <path d={pathD.line} className="price-chart-line" />
          </>
        )}
        {hovered && (
          <>
            <line
              x1={hovered.x}
              y1="0"
              x2={hovered.x}
              y2="100"
              className="price-chart-crosshair"
            />
            <circle cx={hovered.x} cy={hovered.y} r="2.2" className="price-chart-point" />
          </>
        )}
      </svg>

      {hovered && (
        <div
          className="price-chart-tooltip"
          style={{ left: `${hovered.x}%` }}
        >
          <div className="price-chart-tooltip-price">
            {formatUSDValue(hovered.point.price)}
          </div>
          <div className="price-chart-tooltip-time">
            {new Date(hovered.point.timestamp).toLocaleString()}
          </div>
        </div>
      )}
    </div>
  );
}
