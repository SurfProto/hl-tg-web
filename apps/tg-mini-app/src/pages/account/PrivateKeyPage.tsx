import { usePrivy } from '@privy-io/react-auth';

export function PrivateKeyPage() {
  const privy = usePrivy() as any;

  return (
    <div className="min-h-full bg-background px-4 py-5 space-y-4">
      <h1 className="text-2xl font-bold text-foreground">Private key</h1>

      <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
        <p className="text-sm font-semibold text-negative">Your private key gives full access to your wallet funds.</p>
        <p className="mt-2 text-sm text-red-700">Never share it. Only export it if you understand the risk and have a secure place to store it.</p>
      </div>

      <div className="rounded-2xl border border-separator bg-white p-4 shadow-sm space-y-3">
        <p className="text-sm text-foreground">1. Privy will open a secure export flow.</p>
        <p className="text-sm text-foreground">2. Copy your key and store it safely offline.</p>
        <button
          onClick={() => privy.exportWallet?.()}
          className="w-full rounded-full bg-primary px-4 py-3 text-sm font-semibold text-white active:bg-primary-dark transition-colors"
        >
          Export private key
        </button>
      </div>
    </div>
  );
}
