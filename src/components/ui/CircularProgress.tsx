import React from 'react';

interface CircularProgressProps {
  percentage: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  trackColor?: string;
  /** Optional caption rendered beneath the percentage, inside the ring. */
  label?: string;
}

export default function CircularProgress({
  percentage,
  size = 40,
  strokeWidth = 4,
  color = '#4C6EF5',
  trackColor = '#E2E8F0',
  label,
}: CircularProgressProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (percentage / 100) * circumference;

  // Scale the value text down for wider strings (e.g. "100%") so it never
  // touches the ring; shorter values keep the larger, more prominent size.
  const valueText = `${percentage}%`;
  const valueFontSize = size * (valueText.length >= 4 ? 0.2 : 0.26);

  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Background Circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={trackColor}
          strokeWidth={strokeWidth}
        />
        {/* Progress Circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset 0.5s ease' }}
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          lineHeight: 1.1,
        }}
      >
        <span style={{ fontSize: valueFontSize, fontWeight: 'bold', color: '#2D3748' }}>
          {valueText}
        </span>
        {label && (
          <span style={{ fontSize: size * 0.1, color: '#718096', marginTop: size * 0.02 }}>
            {label}
          </span>
        )}
      </div>
    </div>
  );
}
