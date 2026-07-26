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
    <main className="auth-background relative flex h-dvh items-center justify-center overflow-y-auto p-4 text-stone-100 sm:p-7">
      <div className="pointer-events-none absolute left-1/2 top-7 z-10 -translate-x-1/2 text-center lg:hidden">
        <div className="mx-auto grid h-14 w-14 place-items-center border border-amber-400/50 bg-black/50 font-display text-2xl text-amber-200 shadow-[0_0_35px_rgba(217,164,55,.2)]">E</div>
      </div>

      <Panel elevated className="relative grid w-full max-w-6xl overflow-hidden lg:min-h-[680px] lg:grid-cols-[1.15fr_0.85fr]">
        <section className="relative hidden overflow-hidden border-r border-amber-200/20 p-12 lg:flex lg:flex-col lg:justify-between">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_36%,rgba(218,168,57,.17),transparent_27%),linear-gradient(180deg,transparent,rgba(0,0,0,.42))]" />
          <div className="absolute left-1/2 top-1/2 h-[430px] w-[430px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-amber-300/10" />
          <div className="absolute left-1/2 top-1/2 h-[330px] w-[330px] -translate-x-1/2 -translate-y-1/2 rotate-45 border border-amber-300/10" />

          <div className="relative z-10">
            <p className="eyebrow">The gates are open</p>
            <h1 className="font-display mt-4 max-w-xl text-6xl leading-[.95] text-amber-100">
              {t('app.title')}
            </h1>
            <p className="mt-6 max-w-lg text-base leading-7 text-stone-300">
              Enter a persistent realm of old roads, forgotten caverns and heroes whose names will be carved into the chronicles.
            </p>
          </div>

          <div className="relative z-10 mx-auto grid h-52 w-52 place-items-center border border-amber-300/40 bg-black/35 shadow-[inset_0_0_45px_rgba(0,0,0,.65),0_0_55px_rgba(180,122,25,.14)]">
            <div className="absolute inset-3 border border-amber-300/15" />
            <div className="font-display text-center">
              <div className="text-7xl text-amber-200">E</div>
              <div className="mt-2 text-[10px] uppercase tracking-[.42em] text-amber-500/80">Elderglen</div>
            </div>
          </div>

          <div className="relative z-10 grid grid-cols-3 gap-3 text-center text-[10px] font-bold uppercase tracking-[.2em] text-amber-100/70">
            {['Arcane', 'Steel', 'Wilds'].map((label) => (
              <div key={label} className="border border-amber-300/20 bg-black/25 px-3 py-4">
                <span className="mb-2 block text-lg text-amber-300">✦</span>{label}
              </div>
            ))}
          </div>
        </section>

        <section className="relative flex flex-col justify-center p-7 pt-24 sm:p-12 lg:pt-12">
          <div className="absolute right-5 top-5"><LocaleToggle /></div>
          <div className="mx-auto w-full max-w-md">
            <p className="eyebrow">Royal registry</p>
            <h2 className="font-display mt-3 text-4xl text-amber-100">
              {mode === 'sign-in' ? t('auth.signIn') : t('auth.register')}
            </h2>
            <p className="mt-3 text-sm leading-6 text-stone-400">
              {mode === 'sign-in'
                ? 'Present your seal and return to the realm.'
                : 'Write your name into the registry and begin a new legend.'}
            </p>

            <div className="mt-8 flex border border-amber-300/25 bg-black/25 p-1 text-[11px] font-extrabold uppercase tracking-[.16em]">
              <button type="button" onClick={() => mode !== 'sign-in' && switchMode()} className={`flex-1 px-3 py-3 transition ${mode === 'sign-in' ? 'bg-amber-500/20 text-amber-100' : 'text-stone-500 hover:text-amber-200'}`}>
                Sign in
              </button>
              <button type="button" onClick={() => mode !== 'register' && switchMode()} className={`flex-1 px-3 py-3 transition ${mode === 'register' ? 'bg-amber-500/20 text-amber-100' : 'text-stone-500 hover:text-amber-200'}`}>
                Register
              </button>
            </div>

            <form className="mt-7 space-y-5" onSubmit={submit}>
              {mode === 'register' ? (
                <label className="field-label">
                  <span>{t('auth.displayName')}</span>
                  <input className="text-input" value={displayName} onChange={(event: ChangeEvent<HTMLInputElement>) => setDisplayName(event.target.value)} minLength={2} maxLength={40} autoComplete="name" required />
                </label>
              ) : null}
              <label className="field-label">
                <span>{t('auth.email')}</span>
                <input className="text-input" type="email" value={email} onChange={(event: ChangeEvent<HTMLInputElement>) => setEmail(event.target.value)} autoComplete="email" required />
              </label>
              <label className="field-label">
                <span>{t('auth.password')}</span>
                <input className="text-input" type="password" value={password} onChange={(event: ChangeEvent<HTMLInputElement>) => setPassword(event.target.value)} minLength={6} autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} required />
              </label>

              {error ? <div role="alert" className="border border-red-700/60 bg-red-950/45 p-3 text-sm text-red-100">{error}</div> : null}

              <Button className="mt-2 w-full justify-center py-3" busy={busy} type="submit">
                {mode === 'sign-in' ? 'Enter the realm' : 'Create account'}
              </Button>
            </form>

            <p className="mt-7 text-center text-xs leading-5 text-stone-500">
              By entering the realm, you accept the laws of Elderglen and the judgment of its wardens.
            </p>
          </div>
        </section>
      </Panel>
    </main>
  );
}
