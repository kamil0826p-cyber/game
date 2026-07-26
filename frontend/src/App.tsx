import { useAuth } from './auth/AuthProvider';
import { GameConnectionProvider } from './game/realtime/GameConnectionProvider';
import { useGameState } from './game/state/gameStore';
import { useI18n } from './i18n/I18nProvider';
import { AuthScreen } from './screens/AuthScreen';
import { CharacterCreatorScreen } from './screens/CharacterCreatorScreen';
import { CharacterSelectScreen } from './screens/CharacterSelectScreen';
import { ConfigurationScreen } from './screens/ConfigurationScreen';
import { GameScreen } from './screens/GameScreen';
import { LoadingScreen } from './screens/LoadingScreen';

export function App(): React.JSX.Element {
  const auth = useAuth();
  if (auth.loading) {
    return <LoadingScreen message="Restoring Firebase session" />;
  }
  if (auth.configurationErrors.length > 0) {
    return <ConfigurationScreen errors={auth.configurationErrors} />;
  }
  if (!auth.user) {
    return <AuthScreen />;
  }
  return (
    <GameConnectionProvider key={auth.user.uid} user={auth.user}>
      <AuthenticatedClient />
    </GameConnectionProvider>
  );
}

function AuthenticatedClient(): React.JSX.Element {
  const state = useGameState();
  const { t } = useI18n();

  if (state.phase === 'fatal') {
    return (
      <main className="auth-background flex h-dvh items-center justify-center overflow-y-auto p-6 text-slate-100">
        <section className="fantasy-panel max-w-xl p-8 text-center">
          <h1 className="font-display text-3xl text-rose-200">The realm could not be loaded</h1>
          <p className="mt-4 text-sm leading-6 text-slate-300">{state.fatalError}</p>
          <button type="button" className="retro-button mt-6 border-amber-300/70 bg-amber-500/20 text-amber-100" onClick={() => window.location.reload()}>
            Reconnect client
          </button>
        </section>
      </main>
    );
  }

  if (state.phase === 'character-required') {
    return <CharacterCreatorScreen />;
  }
  if (state.phase === 'character-select') {
    return <CharacterSelectScreen />;
  }
  if (state.self && state.map && (state.phase === 'in-world' || state.phase === 'reconnecting')) {
    return <GameScreen />;
  }
  return <LoadingScreen message={state.phase === 'reconnecting' ? t('game.reconnecting') : t('game.connecting')} />;
}
