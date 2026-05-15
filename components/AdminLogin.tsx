'use client';

import { useState } from 'react';
import styles from './AdminLogin.module.css';

export default function AdminLogin() {
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || 'Login failed');
        setSubmitting(false);
        return;
      }
      window.location.href = '/admin';
    } catch {
      setError('Network error');
      setSubmitting(false);
    }
  }

  return (
    <main className={styles.main}>
      <div className={`card ${styles.card}`}>
        <div className={styles.header}>
          <div className={styles.lockIcon} aria-hidden>
            <LockIcon />
          </div>
          <h1 className={`display ${styles.title}`}>Sign in</h1>
          <p className={styles.subtitle}>Enter your password to continue</p>
        </div>

        <form onSubmit={submit} className={styles.form}>
          <label htmlFor="password" className="sr-only">Password</label>
          <input
            id="password"
            type="password"
            className="input"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            autoComplete="current-password"
            required
          />
          {error && <p className={styles.error}>{error}</p>}
          <button
            type="submit"
            className="btn btn-primary"
            disabled={submitting || !password}
            style={{ width: '100%' }}
          >
            {submitting ? 'Checking…' : 'Sign in'}
          </button>
        </form>
      </div>
    </main>
  );
}

function LockIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}
