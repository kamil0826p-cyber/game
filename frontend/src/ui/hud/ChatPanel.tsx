import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';
import type { GuildChatMessagePayload } from '../../contracts/guild';
import type { ChatChannel, ChatMessagePayload } from '../../contracts/socket';
import { useGameConnection } from '../../game/realtime/GameConnectionProvider';
import type { ClientNotification } from '../../game/state/gameStore';
import { useI18n } from '../../i18n/I18nProvider';

type ChatTab = 'Global' | 'Local' | 'Guild' | 'System';

export function ChatPanel({ notifications }: { notifications: readonly ClientNotification[] }): React.JSX.Element {
  const { t, locale } = useI18n();
  const connection = useGameConnection();
  const [tab, setTab] = useState<ChatTab>('Global');
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<ChatMessagePayload[]>([]);
  const [guildMessages, setGuildMessages] = useState<GuildChatMessagePayload[]>([]);
  const [guildId, setGuildId] = useState<string>();
  const guildIdRef = useRef<string>();
  const scrollRef = useRef<HTMLDivElement>(null);
  const tabs: ChatTab[] = ['Global', 'Local', 'Guild', 'System'];

  useEffect(
    () => connection.subscribeChat((message) => {
      setMessages((current) => [...current.slice(-99), message]);
    }),
    [connection],
  );

  useEffect(() => {
    const applyGuild = (nextGuildId?: string) => {
      if (guildIdRef.current !== nextGuildId) {
        guildIdRef.current = nextGuildId;
        setGuildMessages([]);
      }
      setGuildId(nextGuildId);
    };
    const unsubscribeGuild = connection.subscribeGuild((snapshot) => applyGuild(snapshot.guild?.id));
    const unsubscribeChat = connection.subscribeGuildChat((message) => {
      setGuildMessages((current) => [...current.slice(-99), message]);
    });
    void connection.getGuild().then((snapshot) => applyGuild(snapshot.guild?.id)).catch(() => undefined);
    return () => {
      unsubscribeGuild();
      unsubscribeChat();
    };
  }, [connection]);

  const visibleMessages = useMemo(() => {
    if (tab === 'System') {
      return notifications.slice(-30).map((notification) => ({
        id: notification.id,
        author: notification.code,
        text: notification.message,
        tone: 'warning' as const,
      }));
    }
    if (tab === 'Guild') {
      if (!guildId) return [];
      return guildMessages
        .filter((message) => message.guildId === guildId)
        .map((message) => ({
          id: message.id,
          author: message.author,
          text: message.text,
          tone: 'guild' as const,
        }));
    }
    const channel: ChatChannel = tab === 'Global' ? 'GLOBAL' : 'LOCAL';
    return messages
      .filter((message) => message.channel === channel)
      .map((message) => ({
        id: message.id,
        author: message.author,
        text: message.text,
        tone: message.channel === 'LOCAL' ? ('local' as const) : ('player' as const),
      }));
  }, [guildId, guildMessages, messages, notifications, tab]);

  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [visibleMessages]);

  const readOnly = tab === 'System' || (tab === 'Guild' && !guildId);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = input.trim();
    if (!text || sending || readOnly) return;
    setSending(true);
    try {
      if (tab === 'Guild') await connection.sendGuildChat(text);
      else await connection.sendChat(tab === 'Local' ? 'LOCAL' : 'GLOBAL', text);
      setInput('');
    } finally {
      setSending(false);
    }
  };

  const tabLabel = (candidate: ChatTab): string => {
    if (candidate === 'Global') return t('chat.global');
    if (candidate === 'Local') return t('chat.local');
    if (candidate === 'System') return t('chat.system');
    return locale === 'pl' ? 'Klan' : 'Guild';
  };

  const placeholder = readOnly
    ? tab === 'System'
      ? t('chat.systemReadOnly')
      : locale === 'pl'
        ? 'Dołącz do gildii, aby korzystać z czatu klanowego'
        : 'Join a guild to use guild chat'
    : t('chat.placeholder');

  return (
    <section className="hud-panel pointer-events-auto flex h-[220px] w-[min(430px,calc(100vw-24px))] flex-col" aria-label="Chat">
      <nav className="flex border-b border-white/10 bg-slate-950/45">
        {tabs.map((candidate) => (
          <button key={candidate} type="button" onClick={() => setTab(candidate)} className={`chat-tab ${tab === candidate ? 'chat-tab-active' : ''}`}>
            {tabLabel(candidate)}
          </button>
        ))}
        <span className="ml-auto self-center pr-3 text-[9px] uppercase tracking-wider text-emerald-300/60">{t('common.live')}</span>
      </nav>
      <div ref={scrollRef} className="scrollbar-thin flex-1 space-y-1.5 overflow-y-auto p-3 text-xs">
        {visibleMessages.length === 0 ? (
          <p className="text-slate-500">
            {tab === 'Guild' && !guildId ? placeholder : t('chat.noMessages')}
          </p>
        ) : visibleMessages.map((message) => (
          <p key={message.id} className="leading-5 text-slate-300">
            <strong className={message.tone === 'warning' ? 'text-amber-300' : message.tone === 'local' ? 'text-emerald-300' : message.tone === 'guild' ? 'text-yellow-300' : 'text-violet-300'}>
              [{message.author}]
            </strong>{' '}{message.text}
          </p>
        ))}
      </div>
      <form onSubmit={(event) => void submit(event)} className="flex border-t border-amber-400/20 bg-amber-950/10 p-2">
        <input
          value={input}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setInput(event.target.value)}
          className="min-w-0 flex-1 bg-transparent px-2 text-xs text-amber-50 caret-amber-300 outline-none placeholder:text-amber-200/45 disabled:cursor-not-allowed"
          placeholder={placeholder}
          maxLength={160}
          disabled={readOnly || sending}
        />
        <button type="submit" disabled={readOnly || sending || input.trim().length === 0} className="rounded border border-amber-400/30 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-amber-200 hover:bg-amber-400/10 disabled:cursor-not-allowed disabled:opacity-40">
          {sending ? '...' : t('common.send')}
        </button>
      </form>
    </section>
  );
}
