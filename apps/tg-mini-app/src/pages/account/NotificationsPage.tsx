import { useEffect, useState } from 'react';
import { useToken } from '@privy-io/react-auth';
import { useTranslation } from 'react-i18next';
import { fetchProfile, sendTestNotification, updateNotificationPreferences } from '../../lib/profile';

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
  const [testState, setTestState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  const [prefsSaveFailed, setPrefsSaveFailed] = useState(false);

  const runTest = async () => {
    setTestState('sending');
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        setTestState('failed');
        return;
      }

      await sendTestNotification(accessToken);
      setTestState('sent');
    } catch {
      // The endpoint already turns Telegram's own wording into an instruction;
      // showing the raw upstream text here would only leak it to the screen.
      setTestState('failed');
    }
  };

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
    const previous = prefs;
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    setPrefsSaveFailed(false);

    // The switch must not keep showing a preference the server never saved.
    // This governs liquidation alerts: an optimistic toggle with no rollback
    // left a user believing alerts were on while the PATCH had failed as an
    // unhandled rejection.
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        throw new Error('Missing access token');
      }
      await updateNotificationPreferences(accessToken, {
        liquidationAlerts: next.liquidation_alerts,
        orderFills: next.order_fills,
        usdcDeposits: next.usdc_deposits,
      });
    } catch {
      setPrefs(previous);
      setPrefsSaveFailed(true);
    }
  };

  return (
    <div className="editorial-page px-4 py-5 space-y-4">
      <div>
        <p className="editorial-kicker">{t('nav.account')}</p>
        <h1 className="editorial-heading text-foreground">{t('notifications.title')}</h1>
      </div>
      <p className="text-sm text-muted">{t('notifications.description')}</p>

      <div className="rounded-[18px] border border-separator bg-white p-4">
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

      <div className="overflow-hidden rounded-[18px] border border-separator bg-white">
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
            <span className={`inline-flex h-7 w-12 items-center rounded-full p-1 transition-colors ${prefs[key] ? 'bg-primary justify-end' : 'bg-separator justify-start'}`}>
              <span className="h-5 w-5 rounded-full bg-white shadow-sm" />
            </span>
          </button>
        ))}
      </div>

      {prefsSaveFailed && (
        <p role="status" className="text-sm text-negative">
          {t('notifications.prefsSaveFailed')}
        </p>
      )}

      {/*
        A pipeline with nothing to report and a broken one look identical from
        here — which is exactly how working alerts came to be reported as dead.
        This exercises the parts that actually fail: the bot token, the stored
        chat target, and whether Telegram will deliver at all.
      */}
      <button
        type="button"
        onClick={runTest}
        disabled={testState === 'sending'}
        className="mt-4 w-full rounded-[18px] border border-separator bg-white px-4 py-4 text-sm font-semibold text-foreground disabled:opacity-60"
      >
        {testState === 'sending'
          ? t('notifications.sendTestPending')
          : testState === 'sent'
            ? t('notifications.sendTestSent')
            : t('notifications.sendTest')}
      </button>

      {testState === 'failed' && (
        <p role="status" className="mt-2 text-sm text-negative">
          {t('notifications.sendTestFailed')}
        </p>
      )}
    </div>
  );
}
