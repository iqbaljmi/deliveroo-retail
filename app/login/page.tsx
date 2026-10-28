'use client';
import { useState, type FormEvent } from 'react';
import { CircleAlert, LockKeyhole, LogIn, ShoppingBag } from 'lucide-react';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }), cache: 'no-store' });
      const text = await response.text();
      let data;
      try { data = JSON.parse(text); } catch { throw new Error('The app server is unavailable. Please try again.'); }
      if (!response.ok) throw new Error(data.error || 'Unable to sign in.');
      window.location.replace('/');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to sign in.'); setBusy(false); }
  }
  return <main className="login-page">
    <div className="login-brand"><div className="logo"><ShoppingBag size={25}/></div><div><strong>Deliveroo Retail</strong><span>Product Availability Manager</span></div></div>
    <section className="login-card">
      <div className="login-icon"><LockKeyhole size={25}/></div>
      <h1>Welcome back</h1><p>Sign in to manage product availability across your stores.</p>
      <form onSubmit={login}>
        <label htmlFor="username">Username</label>
        <input id="username" name="username" autoComplete="username" autoFocus required value={username} onChange={event=>setUsername(event.target.value)} disabled={busy}/>
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required value={password} onChange={event=>setPassword(event.target.value)} disabled={busy}/>
        {error&&<div className="notice bad" role="alert"><CircleAlert size={18}/>{error}</div>}
        <button className="primary" type="submit" disabled={busy}><LogIn size={18}/>{busy?'Signing in...':'Sign In'}</button>
      </form>
      <small>Use your existing stock manager username and password.</small>
    </section>
  </main>;
}
