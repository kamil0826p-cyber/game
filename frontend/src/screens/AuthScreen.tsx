import { useState, type ChangeEvent, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { Button } from '../components/common/Button';
import { LocaleToggle } from '../components/common/LocaleToggle';
import { useI18n } from '../i18n/I18nProvider';

export function AuthScreen(): React.JSX.Element {
  const { signIn, register, error, clearError } = useAuth();
  const { t } = useI18n();
  const [mode, setMode] = useState<'sign-in' | 'register'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    clearError();
    setBusy(true);
    try {
      if (mode === 'sign-in') await signIn(email, password);
      else await register({ displayName, email, password });
    } catch {
      // AuthProvider exposes a safe form error.
    } finally {
      setBusy(false);
    }
  };

  const switchMode = () => {
    clearError();
    setMode((current) => (current === 'sign-in' ? 'register' : 'sign-in'));
  };

  return (
    <main className="entry-shell">
      <div className="entry-aurora entry-aurora-one" />
      <div className="entry-aurora entry-aurora-two" />
      <header className="entry-topbar">
        <div className="brand-mark"><span>EO</span></div>
        <div className="brand-copy">
          <strong>{t('app.title')}</strong>
          <small>Persistent realm network</small>
        </div>
        <LocaleToggle />
      </header>

      <div className="entry-layout">
        <section className="entry-story">
          <p className="entry-kicker">ENTER THE LIVING REALM</p>
          <h1>Build a legend.<br /><em>Leave a mark.</em></h1>
          <p className="entry-lead">
            A server-authoritative online world where every step, portal and encounter is shared in real time.
          </p>
          <div className="entry-feature-grid">
            <article><span>01</span><strong>Persistent world</strong><p>Your hero and position survive every session.</p></article>
            <article><span>02</span><strong>Live presence</strong><p>See nearby adventurers move across the realm.</p></article>
            <article><span>03</span><strong>Three paths</strong><p>Master steel, arcana or precision.</p></article>
          </div>
          <div className="entry-status"><i /> Realm services online</div>
        </section>

        <section className="access-card">
          <div className="access-card-head">
            <p>{mode === 'sign-in' ? 'WELCOME BACK' : 'BEGIN YOUR JOURNEY'}</p>
            <h2>{mode === 'sign-in' ? t('auth.signIn') : t('auth.register')}</h2>
            <span>{mode === 'sign-in' ? 'Continue where your story paused.' : 'Create an account to enter Elderglen.'}</span>
          </div>

          <div className="access-switch" role="tablist">
            <button type="button" className={mode === 'sign-in' ? 'active' : ''} onClick={() => { clearError(); setMode('sign-in'); }}>Sign in</button>
            <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => { clearError(); setMode('register'); }}>Register</button>
          </div>

          <form className="access-form" onSubmit={submit}>
            {mode === 'register' ? (
              <label><span>{t('auth.displayName')}</span><input className="text-input" value={displayName} onChange={(event: ChangeEvent<HTMLInputElement>) => setDisplayName(event.target.value)} minLength={2} maxLength={40} autoComplete="name" required /></label>
            ) : null}
            <label><span>{t('auth.email')}</span><input className="text-input" type="email" value={email} onChange={(event: ChangeEvent<HTMLInputElement>) => setEmail(event.target.value)} autoComplete="email" required /></label>
            <label><span>{t('auth.password')}</span><input className="text-input" type="password" value={password} onChange={(event: ChangeEvent<HTMLInputElement>) => setPassword(event.target.value)} minLength={6} autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} required /></label>
            {error ? <div role="alert" className="access-error">{error}</div> : null}
            <Button className="w-full justify-center" busy={busy} type="submit">
              {mode === 'sign-in' ? 'Enter realm' : 'Create account'}
            </Button>
          </form>

          <button type="button" onClick={switchMode} className="access-alternate">
            {mode === 'sign-in' ? t('auth.switchToRegister') : t('auth.switchToSignIn')}
          </button>
        </section>
      </div>
    </main>
  );
}
