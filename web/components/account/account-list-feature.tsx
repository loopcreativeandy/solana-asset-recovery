'use client';

import { redirect } from 'next/navigation';
import { useCompromisedContext } from '../compromised/compromised.provider';
import { CompromisedWalletButton } from '../compromised/compromised.ui';
import { AppHero } from '../ui/ui-layout';
import { ModalHelp } from './account-detail-feature';

export default function AccountListFeature() {
  const { publicKey } = useCompromisedContext();

  if (publicKey) {
    return redirect(`/account/${publicKey.toString()}`);
  }

  return (
    <AppHero
      title="Account"
      subtitle="Recover assets from a wallet"
      HelpModal={ModalHelp}
    >
      <div className="flex gap-2 items-center justify-center">
        <h2 className="text-md font-bold">Compromised wallet:</h2>
        <CompromisedWalletButton />
      </div>
    </AppHero>
  );
}
