/**
 * ChangePasswordModal Component
 *
 * Modal for updating the master password.
 */
import React, { useState } from 'react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

function ChangePasswordModal({ isOpen, onClose }: Props) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const resetForm = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setError('');
    setSuccess(false);
    setLoading(false);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const isValid =
    currentPassword.length > 0 &&
    newPassword.length >= 8 &&
    newPassword === confirmPassword;

  const handleSubmit = async () => {
    if (!isValid || loading) return;
    if (currentPassword === newPassword) {
      setError('New password must be different from the current password.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'CHANGE_PASSWORD',
        payload: {
          currentPassword,
          newPassword,
        },
      });

      if (response?.error) {
        setError(response.error);
      } else {
        setSuccess(true);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to change password');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="account-menu-overlay" onClick={handleClose}>
      <div className="account-menu" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '400px' }}>
        <div className="account-menu-header">
          <div className="account-menu-title">Change Password</div>
          <button className="close-btn" onClick={handleClose}>×</button>
        </div>

        <div className="account-menu-section" style={{ padding: '16px' }}>
          {success ? (
            <>
              <div className="alert alert-success" style={{
                background: 'var(--success-light)',
                border: '1px solid var(--success)',
                borderRadius: '8px',
                padding: '12px',
                marginBottom: '16px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '18px' }}>✅</span>
                  <div style={{ fontSize: '13px', color: 'var(--success-dark)', lineHeight: 1.5 }}>
                    Password updated successfully.
                  </div>
                </div>
              </div>

              <button className="btn btn-primary" onClick={handleClose} style={{ width: '100%' }}>
                Done
              </button>
            </>
          ) : (
            <>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                Enter your current password and choose a new one (min 8 characters).
              </p>

              <div className="form-group">
                <label>Current Password</label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter current password"
                />
              </div>

              <div className="form-group">
                <label>New Password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Create a new password"
                />
              </div>

              <div className="form-group">
                <label>Confirm New Password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter new password"
                  onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                />
              </div>

              {error && <div className="error" style={{ marginBottom: '12px' }}>{error}</div>}

              <div style={{ display: 'flex', gap: '12px' }}>
                <button className="btn btn-secondary" onClick={handleClose} style={{ flex: 1 }}>
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleSubmit}
                  disabled={loading || !isValid}
                  style={{ flex: 1 }}
                >
                  {loading ? 'Updating...' : 'Update Password'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default ChangePasswordModal;
