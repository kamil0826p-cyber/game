import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';
import type { ChatChannel, ChatMessagePayload } from '../../contracts/socket';
import { useGameConnection } from '../../game/realtime/GameConnectionProvider';
import type { ClientNotification } from '../../game/state/gameStore';
import { useI18n } from '../../i18n/I18nProvider';

type ChatTab = 'Global' | 'Local' | 'System';

export function ChatPanel({ notifications }: { notifications: readonly ClientNotification[] }): React.JSX.Element {
  const { t } = useI18n();
  const connection = useGameConnection();
  const [tab, setTab] = useState<ChatTab>('Global');
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<ChatMessagePayload[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const tabs: ChatTab[] = ['Global', 'Local', 'System'];

  useEffect(
    () => connection.subscribeChat((message) => {
      setMessages((current) => [...current.slice(-99), message]);
    }),
    [connection],
  );

  const visibleMessages = useMemo(() => {
    if (tab === 'System') {
      return notifications.slice(-30).map((notification) => ({
        id: notification.id,
        author: notification.code,
        text: notification.message,
        tone: 'warning' as const,
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
  }, [messages, notifications, tab]);

  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [visibleMessages]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = input.trim();
    if (!text || sending || tab === 'System') return;
    setSending(true);
    try {
      await connection.sendChat(tab === 'Local' ? 'LOCAL' : 'GLOBAL', text);
      setInput('');
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="hud-panel pointer-events-auto flex h-[220px] w-[min(430px,calc(100vw-24px))] flex-col" aria-label="Chat">
      <nav className="flex border-b border-white/10 bg-slate-950/45">
        {tabs.map((candidate) => (
          <button key={candidate} type="button" onClick={() => setTab(candidate)} className={`chat-tab ${tab === candidate ? 'chat-tab-active' : ''}`}>
            {candidate === 'Global' ? t('chat.global') : candidate === 'Local' ? t('chat.local') : t('chat.system')}
          </button>
        ))}
        <span className="ml-auto self-center pr-3 text-[9px] uppercase tracking-wider text-emerald-300/60">{t('common.live')}</span>
      </nav>
      <div ref={scrollRef} className="scrollbar-thin flex-1 space-y-1.5 overflow-y-auto p-3 text-xs">
        {visibleMessages.length === 0 ? (
          <p className="text-slate-500">{t('chat.noMessages')}</p>
        ) : visibleMessages.map((message) => (
          <p key={message.id} className="leading-5 text-slate-300">
            <strong className={message.tone === 'warning' ? 'text-amber-300' : message.tone === 'local' ? 'text-emerald-300' : 'text-violet-300'}>
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
          placeholder={tab === 'System' ? t('chat.systemReadOnly') : t('chat.placeholder')}
          maxLength={160}
          disabled={tab === 'System' || sending}
        />
        <button type="submit" disabled={tab === 'System' || sending || input.trim().length === 0} className="rounded border border-amber-400/30 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-amber-200 hover:bg-amber-400/10 disabled:cursor-not-allowed disabled:opacity-40">
          {sending ? '...' : t('common.send')}
        </button>
      </form>
    </section>
  );
}
