/**
 * @fileoverview Shared back-chevron + title row for takeover screens.
 *
 * Replaces the ad-hoc `.back-button` + inline `<h2>` pattern used by Send,
 * Receive, and other secondary views so spacing, weight, and icon size stay
 * consistent across the popup.
 */
import React from 'react';
import backIcon from '../../../assets/icons/arrow-left.svg';

interface Props {
  /** Rendered as the row title (e.g. "Send", "Receive ETH"). */
  title: string;
  onBack: () => void;
}

export function ScreenHeader({ title, onBack }: Props) {
  return (
    <div className="screen-header">
      <button
        type="button"
        className="back-button"
        onClick={onBack}
        aria-label="Back"
      >
        <img src={backIcon} alt="" />
      </button>
      <span className="screen-header__title">{title}</span>
    </div>
  );
}

export default ScreenHeader;
