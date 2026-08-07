import { useEffect, useState } from 'react';
import { usePrivy, useToken, useWallets } from '@privy-io/react-auth';
import { useTranslation } from 'react-i18next';
import { useHaptics } from '../../hooks/useHaptics';
import { fetchProfile } from '../../lib/profile';

export function PersonalInfoPage() {
  const haptics = useHaptics();
  const { t } = useTranslation();
  const privy = usePrivy() as any;
  const { getAccessToken } = useToken();
  const { user } = privy;
  const { wallets } = useWallets();
  const walletAddress = user?.wallet?.address ?? wallets[0]?.address;
  const [username, setUsername] = useState('');

  useEffect(() => {
    void (async () => {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        setUsername(user?.telegram?.username ?? '');
        return;
      }

      try {
        const { profile } = await fetchProfile(accessToken);
        setUsername(profile.username ?? user?.telegram?.username ?? '');
      } catch {
        setUsername(user?.telegram?.username ?? '');
      }
    })();
  }, [getAccessToken, user?.telegram?.username, walletAddress]);

  return (
    <div className="editorial-page px-4 py-5 space-y-4">
      <p className="editorial-kicker">{t('nav.account')}</p>
      <h1 className="editorial-heading text-foreground">{t('personalInfo.title')}</h1>

      <div className="rounded-[18px] border border-separator bg-white p-4 space-y-4">
        <div>
          <p className="text-xs text-muted">{t('personalInfo.walletAddress')}</p>
          <div className="mt-2 flex items-center justify-between gap-3 rounded-xl bg-surface px-4 py-3">
            <span className="font-mono text-sm text-foreground break-all">{walletAddress ?? t('personalInfo.noWallet')}</span>
            <button
              type="button"
              onClick={async () => {
                if (!walletAddress) return;
                await navigator.clipboard.writeText(walletAddress);
                haptics.success();
              }}
              className="flex-shrink-0 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-foreground border border-separator"
            >
              {t('common.copy')}
            </button>
          </div>
        </div>

        <div>
          <p className="text-xs text-muted">{t('personalInfo.username')}</p>
          <div className="mt-2 rounded-xl border border-separator bg-surface px-4 py-3 text-sm text-foreground">
            {username || t('personalInfo.usernamePlaceholder')}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted">{t('personalInfo.email')}</p>
            <p className="mt-1 text-sm text-foreground">{user?.email?.address ?? t('common.notLinked')}</p>
          </div>
          {!user?.email?.address && (
            <button type="button" onClick={() => privy.linkEmail?.()} className="rounded-lg bg-surface px-4 py-2 text-sm font-semibold text-foreground">
              {t('common.add')}
            </button>
          )}
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted">{t('personalInfo.phone')}</p>
            <p className="mt-1 text-sm text-foreground">{user?.phone?.number ?? t('common.notLinked')}</p>
          </div>
          {!user?.phone?.number && (
            <button type="button" onClick={() => privy.linkPhone?.()} className="rounded-lg bg-surface px-4 py-2 text-sm font-semibold text-foreground">
              {t('common.add')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
