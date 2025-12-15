/**
 * @fileoverview QR Code display component using SVG.
 *
 * Uses a simple QR code generation algorithm for display purposes.
 * For production, consider react-native-qrcode-svg for better performance.
 */

import React, { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';

interface QRCodeProps {
  value: string;
  size?: number;
  backgroundColor?: string;
  color?: string;
}

/**
 * Simple QR code generator component.
 *
 * Note: This is a simplified implementation. For production use,
 * install react-native-qrcode-svg: npm install react-native-qrcode-svg react-native-svg
 */
export function QRCode({
  value,
  size = 200,
  backgroundColor = '#ffffff',
  color = '#000000',
}: QRCodeProps) {
  // Generate QR matrix
  const matrix = useMemo(() => generateQRMatrix(value), [value]);
  const cellSize = size / matrix.length;

  return (
    <View
      style={{
        width: size,
        height: size,
        backgroundColor,
        padding: cellSize * 2,
        borderRadius: 12,
      }}
    >
      <Svg width={size - cellSize * 4} height={size - cellSize * 4}>
        {matrix.map((row, y) =>
          row.map((cell, x) =>
            cell ? (
              <Rect
                key={`${x}-${y}`}
                x={x * cellSize}
                y={y * cellSize}
                width={cellSize}
                height={cellSize}
                fill={color}
              />
            ) : null
          )
        )}
      </Svg>
    </View>
  );
}

/**
 * Generate a simple QR-like matrix for display.
 * This is a placeholder - real QR codes need proper encoding.
 */
function generateQRMatrix(data: string): boolean[][] {
  const size = 25; // Standard QR size for short data
  const matrix: boolean[][] = Array(size)
    .fill(null)
    .map(() => Array(size).fill(false));

  // Add finder patterns (corners)
  addFinderPattern(matrix, 0, 0);
  addFinderPattern(matrix, size - 7, 0);
  addFinderPattern(matrix, 0, size - 7);

  // Add timing patterns
  for (let i = 8; i < size - 8; i++) {
    matrix[6][i] = i % 2 === 0;
    matrix[i][6] = i % 2 === 0;
  }

  // Add alignment pattern
  const alignPos = size - 7 - 2;
  addAlignmentPattern(matrix, alignPos, alignPos);

  // Fill data area with hash-based pattern
  const hash = simpleHash(data);
  let bitIndex = 0;
  for (let col = size - 1; col >= 0; col -= 2) {
    if (col === 6) col--; // Skip timing column
    for (let row = 0; row < size; row++) {
      for (let c = 0; c < 2 && col - c >= 0; c++) {
        const x = col - c;
        const y = row;
        if (!isReserved(x, y, size)) {
          matrix[y][x] = ((hash >> (bitIndex % 32)) & 1) === 1;
          bitIndex++;
        }
      }
    }
  }

  return matrix;
}

function addFinderPattern(matrix: boolean[][], startX: number, startY: number) {
  for (let y = 0; y < 7; y++) {
    for (let x = 0; x < 7; x++) {
      const isEdge = x === 0 || x === 6 || y === 0 || y === 6;
      const isCenter = x >= 2 && x <= 4 && y >= 2 && y <= 4;
      matrix[startY + y][startX + x] = isEdge || isCenter;
    }
  }
}

function addAlignmentPattern(matrix: boolean[][], centerX: number, centerY: number) {
  for (let y = -2; y <= 2; y++) {
    for (let x = -2; x <= 2; x++) {
      const isEdge = Math.abs(x) === 2 || Math.abs(y) === 2;
      const isCenter = x === 0 && y === 0;
      matrix[centerY + y][centerX + x] = isEdge || isCenter;
    }
  }
}

function isReserved(x: number, y: number, size: number): boolean {
  // Finder patterns + separators
  if (x < 9 && y < 9) return true;
  if (x < 9 && y >= size - 8) return true;
  if (x >= size - 8 && y < 9) return true;
  // Timing patterns
  if (x === 6 || y === 6) return true;
  // Alignment pattern area
  const alignPos = size - 9;
  if (x >= alignPos - 2 && x <= alignPos + 2 && y >= alignPos - 2 && y <= alignPos + 2) return true;
  return false;
}

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return Math.abs(hash);
}
