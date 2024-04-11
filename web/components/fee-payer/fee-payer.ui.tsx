'use client';

import { OutPortal } from 'react-reverse-portal';
import { AccountBalance } from '../account/account-ui';
import { ExplorerLink } from '../cluster/cluster-ui';
import { useCompromisedContext } from '../compromised/compromised.provider';
import { ellipsify } from '../ui/ui-layout';
import { useFeePayerContext, useFeePayerUIContext } from './fee-payer.provider';

export function FeePayerWalletButton() {
  const portalNode = useFeePayerUIContext();
  const feePayer = useFeePayerContext();
  const wallet = useCompromisedContext();

  return (
    <>
      {portalNode && <OutPortal node={portalNode} />}
      {feePayer.publicKey?.toBase58() === wallet.publicKey?.toBase58() ? (
        <div className="alert alert-warning">
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
