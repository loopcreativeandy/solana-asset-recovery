'use client';

import { useWallet } from '@solana/wallet-adapter-react';
import { WalletButton } from '../solana/solana-provider';

import { redirect } from 'next/navigation';

export default function AccountListFeature() {
  const { publicKey } = useWallet();

  if (publicKey) {
    return redirect(`/account/${publicKey.toString()}`);
  }

  return (
    <div className="hero py-[64px]">
      <div className="hero-content text-center">
        <div className="flex gap-2 items-center justify-center">
          <h2 className="text-xl font-bold">Compromised wallet:</h2>
          <WalletButton />
        </div>
      </div>
    </div>
  );
}
