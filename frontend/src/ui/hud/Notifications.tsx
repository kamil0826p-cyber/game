import { useEffect, type RefObject } from 'react';
import { gameStore, type ClientNotification } from '../../game/state/gameStore';

const isCollisionNotification = (notification: ClientNotification): boolean => {
  const code = notification.code.toUpperCase();
  const message = notification.message.toLowerCase();
  return (
    code === 'MOVE_COLLISION' ||
    code === 'PATH_UNAVAILABLE' ||
    code === 'DESTINATION_BLOCKED' ||
    message.includes('destination tile is blocked')
  );
};

function NotificationToast({ notification }: { notification: ClientNotification }): React.JSX.Element {
  useEffect(() => {
    const timer = window.setTimeout(() => gameStore.dismissNotification(notification.id), 5_000);
    return () => window.clearTimeout(timer);
  }, [notification.id]);
  return (
    <button type="button" onClick={() => gameStore.dismissNotification(notification.id)} className="notification-toast text-left">
      <strong>{notification.code.replaceAll('_', ' ')}</strong><span>{notification.message}</span>
    </button>
  );
}

interface NotificationsProps {
  notifications: readonly ClientNotification[];
  containerRef?: RefObject<HTMLDivElement | null>;
}

export function Notifications({ notifications, containerRef }: NotificationsProps): React.JSX.Element {
  const visibleNotifications = notifications.filter((notification) => !isCollisionNotification(notification));

  return (
    <div ref={containerRef} className="hud-occludable pointer-events-auto fixed left-1/2 top-24 z-40 flex w-[min(420px,calc(100vw-24px))] -translate-x-1/2 flex-col gap-2">
      {visibleNotifications.slice(-3).map((notification) => <NotificationToast key={notification.id} notification={notification} />)}
    </div>
  );
}
