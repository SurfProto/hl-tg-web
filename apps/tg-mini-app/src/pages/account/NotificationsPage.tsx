import { useEffect, useState } from 'react';
import { useToken } from '@privy-io/react-auth';
import { useTranslation } from 'react-i18next';
import { fetchProfile, updateNotificationPreferences } from '../../lib/profile';

type NotificationPrefs = {
  liquidation_alerts: boolean;
  order_fills: boolean;
  usdc_deposits: boolean;
};

const DEFAULT_PREFS: NotificationPrefs = {
  liquidation_alerts: true,
  order_fills: true,
  usdc_deposits: true,
};

type DeliveryState = 'active' | 'blocked' | 'invalid' | 'unavailable';

function getDeliveryState(
  telegramId: string | null | undefined,
  channelStatus: string | null | undefined,
): DeliveryState {
  if (!telegramId) return 'unavailable';
  if (channelStatus === 'blocked') return 'blocked';
  if (channelStatus === 'invalid') return 'invalid';
  return 'active';
}

export function NotificationsPage() {
  const { getAccessToken } = useToken();
  const { t } = useTranslation();
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS);
  const [deliveryState, setDeliveryState] = useState<DeliveryState>('unavailable');

  useEffect(() => {
    void (async () => {
      const accessToken = await getAccessToken();
      if (!accessToken) return;

      try {
        const { profile, notificationPreferences, telegramDeliveryStatus } =
          await fetchProfile(accessToken);
        setPrefs({
          liquidation_alerts: notificationPreferences.liquidationAlerts,
          order_fills: notificationPreferences.orderFills,
          usdc_deposits: notificationPreferences.usdcDeposits,
        });
        setDeliveryState(
          getDeliveryState(profile.telegramId, telegramDeliveryStatus),
        );
      } catch {
        setPrefs(DEFAULT_PREFS);
        setDeliveryState('unavailable');
      }
    })();
  }, [getAccessToken]);

  const updatePref = async (key: keyof NotificationPrefs) => {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    const accessToken = await getAccessToken();
    if (!accessToken) return;
    await updateNotificationPreferences(accessToken, {
      liquidationAlerts: next.liquidation_alerts,
      orderFills: next.order_fills,
      usdcDeposits: next.usdc_deposits,
    });
  };

  return (
    <div className="min-h-full bg-background px-4 py-5 space-y-4">
      <h1 className="text-2xl font-bold text-foreground">{t('notifications.title')}</h1>
      <p className="text-sm text-muted">{t('notifications.description')}</p>

      <div className="rounded-2xl border border-separator bg-white p-4 shadow-sm">
        <p className="text-sm font-semibold text-foreground">
          {deliveryState === 'blocked'
            ? t('notifications.deliveryBlockedTitle')
            : deliveryState === 'invalid'
              ? t('notifications.deliveryInvalidTitle')
              : deliveryState === 'active'
                ? t('notifications.deliveryActiveTitle')
                : t('notifications.deliveryUnavailableTitle')}
        </p>
        <p className="mt-1 text-sm text-muted">
          {deliveryState === 'blocked'
            ? t('notifications.deliveryBlockedBody')
            : deliveryState === 'invalid'
              ? t('notifications.deliveryInvalidBody')
              : deliveryState === 'active'
                ? t('notifications.deliveryActiveBody')
                : t('notifications.deliveryUnavailableBody')}
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-separator bg-white shadow-sm">
        {([
          ['liquidation_alerts', t('notifications.liquidationAlerts')],
          ['order_fills', t('notifications.orderFills')],
          ['usdc_deposits', t('notifications.usdcDeposits')],
        ] as [keyof NotificationPrefs, string][]).map(([key, label], index) => (
          <button
            key={key}
            onClick={() => updatePref(key)}
            className={`flex w-full items-center justify-between px-4 py-4 text-left ${index < 2 ? 'border-b border-separator' : ''}`}
          >
            <span className="text-sm font-semibold text-foreground">{label}</span>
            <span className={`inline-flex h-7 w-12 items-center rounded-full p-1 transition-colors ${prefs[key] ? 'bg-primary justify-end' : 'bg-gray-200 justify-start'}`}>
              <span className="h-5 w-5 rounded-full bg-white shadow-sm" />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
