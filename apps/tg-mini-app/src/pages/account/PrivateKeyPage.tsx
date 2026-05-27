import { usePrivy } from '@privy-io/react-auth';
import { useTranslation } from 'react-i18next';

export function PrivateKeyPage() {
  const privy = usePrivy() as any;
  const { t } = useTranslation();

  return (
    <div className="editorial-page px-4 py-5 space-y-4">
      <p className="editorial-kicker">{t('nav.account')}</p>
      <h1 className="editorial-heading text-foreground">{t('privateKey.title')}</h1>

      <div className="rounded-[18px] border border-negative/20 bg-negative/5 p-4">
        <p className="text-sm font-semibold text-negative">{t('privateKey.warningTitle')}</p>
        <p className="mt-2 text-sm text-red-700">{t('privateKey.warningText')}</p>
      </div>

      <div className="rounded-[18px] border border-separator bg-white p-4 space-y-3">
        <p className="text-sm text-foreground">{t('privateKey.step1')}</p>
        <p className="text-sm text-foreground">{t('privateKey.step2')}</p>
        <button
          onClick={() => privy.exportWallet?.()}
          className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white active:bg-primary-dark transition-colors"
        >
          {t('privateKey.exportButton')}
        </button>
      </div>
    </div>
  );
}
