import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import type { User } from 'firebase/auth';
import { useI18n } from '../../i18n/I18nProvider';
import { installBuildcraftLocalization } from '../skills/buildcraftLocalization';
import { GameSocketClient } from './GameSocketClient';
import { installExpeditionSocketBridge } from './expeditionSocketBridge';
import { installGroupSocketBridge } from './groupSocketBridge';
import { installGuildSocketBridge } from './guildSocketBridge';
import { installItemizationSocketBridge } from './itemizationSocketBridge';
import { installMobSocketBridge } from './mobSocketBridge';
import { installCharacterProgressionSocketBridge } from './progressionSocketBridge';

const GameConnectionContext = createContext<GameSocketClient | undefined>(undefined);
interface GameConnectionProviderProps extends PropsWithChildren { user: User; }

export function GameConnectionProvider({ user, children }: GameConnectionProviderProps): React.JSX.Element {
  const { locale } = useI18n();
  const clientRef = useRef<GameSocketClient | undefined>(undefined);
  installBuildcraftLocalization(locale);
  if (!clientRef.current) {
    clientRef.current = new GameSocketClient(user, locale);
    installGuildSocketBridge(clientRef.current);
    installMobSocketBridge(clientRef.current);
    installGroupSocketBridge(clientRef.current);
    installCharacterProgressionSocketBridge(clientRef.current);
    installItemizationSocketBridge(clientRef.current);
    installExpeditionSocketBridge(clientRef.current);
  }
  useEffect(() => {
    const client = clientRef.current!;
    client.connect();
    return () => client.disconnect();
  }, []);
  useEffect(() => { clientRef.current?.setLocale(locale); }, [locale]);
  const value = useMemo(() => clientRef.current!, []);
  return <GameConnectionContext.Provider value={value}>{children}</GameConnectionContext.Provider>;
}

export function useGameConnection(): GameSocketClient {
  const context = useContext(GameConnectionContext);
  if (!context) throw new Error('useGameConnection must be used inside GameConnectionProvider.');
  return context;
}
