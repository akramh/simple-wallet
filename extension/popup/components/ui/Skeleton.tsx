import React from 'react';

interface Props {
  className?: string;
  width?: string | number;
  height?: string | number;
  borderRadius?: string | number;
  style?: React.CSSProperties;
}

export function Skeleton({ className = '', width, height, borderRadius, style = {} }: Props) {
  const finalStyle: React.CSSProperties = { ...style };
  if (width) finalStyle.width = width;
  if (height) finalStyle.height = height;
  if (borderRadius) finalStyle.borderRadius = borderRadius;

  return <div className={`skeleton ${className}`} style={finalStyle} />;
}

export default Skeleton;
