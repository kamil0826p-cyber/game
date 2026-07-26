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
      // The provider exposes a safe error message for the form.
    } finally {
      setBusy(false);
    }
  };

  const switchMode = () => {
    clearError();
    setMode((current) => (current === 'sign-in' ? 'register' : 'sign-in'));
  };

  return (
    <main className="royal-gateway min-h-dvh overflow-y-auto text-stone-100">
      <div className="royal-gateway-vignette" />
      <header className="royal-topbar">
        <div className="royal-brand-mark">EG</div>
        <div>
          <p className="royal-kicker">Chronicles of the old realm</p>
          <h1 className="royal-wordmark">{t('app.title')}</h1>
        </div>
        <LocaleToggle />
      </header>

      <div className="royal-auth-layout">
        <section className="royal-hero-copy">
          <div className="royal-crest"><span>♜</span></div>
          <p className="royal-overline">A persistent medieval world</p>
          <h2>Forge a name.<br /><em>Claim a legend.</em></h2>
          <p className="royal-lead">Enter a living realm of old roads, guarded towns, forgotten caverns and rival heroes. Your story begins at the gate.</p>
          <div className="royal-oaths">
            <article><b>01</b><span>Choose your calling</span></article>
            <article><b>02</b><span>Cross the kingdom</span></article>
            <article><b>03</b><span>Write your chronicle</span></article>
          </div>
        </section>

        <section className="royal-auth-card">
          <div className="royal-card-corners" />
          <div className="royal-auth-heading">
            <span className="royal-seal">✦</span>
            <p>{mode === 'sign-in' ? 'Return to the realm' : 'Swear your first oath'}</p>
            <h3>{mode === 'sign-in' ? t('auth.signIn') : t('auth.register')}</h3>
          </div>

          <form className="royal-form" onSubmit={submit}>
            {mode === 'register' ? (
              <label className="field-label"><span>{t('auth.displayName')}</span><input className="text-input" value={displayName} onChange={(event: ChangeEvent<HTMLInputElement>) => setDisplayName(event.target.value)} minLength={2} maxLength={40} autoComplete="name" required /></label>
            ) : null}
            <label className="field-label"><span>{t('auth.email')}</span><input className="text-input" type="email" value={email} onChange={(event: ChangeEvent<HTMLInputElement>) => setEmail(event.target.value)} autoComplete="email" required /></label>
            <label className="field-label"><span>{t('auth.password')}</span><input className="text-input" type="password" value={password} onChange={(event: ChangeEvent<HTMLInputElement>) => setPassword(event.target.value)} minLength={6} autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} required /></label>
            {error ? <div role="alert" className="royal-error">{error}</div> : null}
            <Button className="royal-primary-action" busy={busy} type="submit">{mode === 'sign-in' ? t('auth.signIn') : t('auth.register')}</Button>
          </form>

          <button type="button" onClick={switchMode} className="royal-mode-switch">
            <span>{mode === 'sign-in' ? 'No chronicle yet?' : 'Already sworn in?'}</span>
            <strong>{mode === 'sign-in' ? t('auth.switchToRegister') : t('auth.switchToSignIn')}</strong>
          </button>
        </section>
      </div>
    </main>
  );
}