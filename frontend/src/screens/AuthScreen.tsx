import { useState, type ChangeEvent, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { Button } from '../components/common/Button';
import { LocaleToggle } from '../components/common/LocaleToggle';
import { Panel } from '../components/common/Panel';
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
      if (mode === 'sign-in') {
        await signIn(email, password);
      } else {
        await register({ displayName, email, password });
      }
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
    <main className="auth-background relative flex h-dvh items-center justify-center overflow-y-auto p-5 text-slate-100">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(245,158,11,0.08),transparent_35%)]" />
      <Panel elevated className="relative grid w-full max-w-5xl overflow-hidden lg:grid-cols-[1.1fr_0.9fr]">
        <section className="hidden min-h-[620px] border-r border-amber-100/10 p-10 lg:flex lg:flex-col lg:justify-between">
          <div>
            <p className="eyebrow">Persistent online world</p>
            <h1 className="font-display mt-3 text-5xl leading-tight text-amber-100">
              {t('app.title')}
            </h1>
            <p className="mt-4 max-w-lg text-base leading-7 text-slate-300">
              {t('app.subtitle')}. Explore tile-based maps, cross automatic portals, and
              watch nearby heroes move in real time.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center text-xs uppercase tracking-[0.18em] text-slate-400">
            <div className="rounded-lg border border-violet-400/20 bg-violet-500/5 p-4">Mage</div>
            <div className="rounded-lg border border-rose-400/20 bg-rose-500/5 p-4">Warrior</div>
            <div className="rounded-lg border border-emerald-400/20 bg-emerald-500/5 p-4">Archer</div>
          </div>
        </section>

        <section className="p-6 sm:p-10">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="eyebrow">Firebase authentication</p>
              <h2 className="font-display mt-2 text-3xl text-amber-100">
                {mode === 'sign-in' ? t('auth.signIn') : t('auth.register')}
              </h2>
            </div>
            <LocaleToggle />
          </div>

          <form className="mt-8 space-y-5" onSubmit={submit}>
            {mode === 'register' ? (
              <label className="field-label">
                <span>{t('auth.displayName')}</span>
                <input
                  className="text-input"
                  value={displayName}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    setDisplayName(event.target.value)
                  }
                  minLength={2}
                  maxLength={40}
                  autoComplete="name"
                  required
                />
              </label>
            ) : null}
            <label className="field-label">
              <span>{t('auth.email')}</span>
              <input
                className="text-input"
                type="email"
                value={email}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  setEmail(event.target.value)
                }
                autoComplete="email"
                required
              />
            </label>
            <label className="field-label">
              <span>{t('auth.password')}</span>
              <input
                className="text-input"
                type="password"
                value={password}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  setPassword(event.target.value)
                }
                minLength={6}
                autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
                required
              />
            </label>

            {error ? (
              <div role="alert" className="rounded-lg border border-rose-500/40 bg-rose-950/50 p-3 text-sm text-rose-100">
                {error}
              </div>
            ) : null}

            <Button className="w-full justify-center py-3" busy={busy} type="submit">
              {mode === 'sign-in' ? t('auth.signIn') : t('auth.register')}
            </Button>
          </form>

          <button
            type="button"
            onClick={switchMode}
            className="mt-6 w-full text-center text-sm text-slate-400 transition hover:text-amber-200"
          >
            {mode === 'sign-in' ? t('auth.switchToRegister') : t('auth.switchToSignIn')}
          </button>
        </section>
      </Panel>
    </main>
  );
}
