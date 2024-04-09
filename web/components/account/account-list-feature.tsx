'use client';

import { redirect } from 'next/navigation';
import { useCompromisedContext } from '../compromised/compromised.provider';
import { CompromisedWalletButton } from '../compromised/compromised.ui';
import { AppHero } from '../ui/ui-layout';

export default function AccountListFeature() {
  const { publicKey } = useCompromisedContext();

  if (publicKey) {
    return redirect(`/account/${publicKey.toString()}`);
  }

  return (
    <AppHero title="Account" subtitle="Recover assets from a wallet">
      <div className="flex gap-2 items-center justify-center">
        <h2 className="text-xl font-bold">Compromised wallet:</h2>
        <CompromisedWalletButton />
      </div>
    </AppHero>
  );
}
