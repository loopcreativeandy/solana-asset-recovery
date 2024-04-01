'use client';

import { OutPortal } from 'react-reverse-portal';
import { useFeePayerContext, useFeePayerUIContext } from './fee-payer.provider';
import { useWallet } from '@solana/wallet-adapter-react';
import { ExplorerLink } from '../cluster/cluster-ui';
import { ellipsify } from '../ui/ui-layout';
import { AccountBalance } from '../account/account-ui';

export function FeePayerWalletButton() {
  const portalNode = useFeePayerUIContext();
  const feePayer = useFeePayerContext();
  const wallet = useWallet();

  return (
    <>
      {portalNode && <OutPortal node={portalNode} />}
      {feePayer.publicKey?.toBase58() === wallet.publicKey?.toBase58() ? (
        <div className="text-red-600">
          You need to connect different wallets
        </div>
      ) : (
        feePayer.publicKey && (
          <div className="flex flex-col">
            <div>
              Have some (&gt; 0.005) SOL in your safe wallet{' '}
              <b>
                <ExplorerLink
                  label={ellipsify(feePayer.publicKey.toBase58())}
                  path={`account/${feePayer.publicKey.toBase58()}`}
                />
              </b>
            </div>

            <AccountBalance address={feePayer.publicKey}></AccountBalance>
          </div>
        )
      )}
    </>
  );
}
