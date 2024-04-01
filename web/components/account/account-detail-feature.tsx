'use client';

import { PublicKey, SystemProgram } from '@solana/web3.js';
import { useMemo } from 'react';

import { useParams } from 'next/navigation';

import { AccountLayout, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { useWallet } from '@solana/wallet-adapter-react';
import { ExplorerLink } from '../cluster/cluster-ui';
import { useFeePayerContext } from '../fee-payer/fee-payer.provider';
import { FeePayerWalletButton } from '../fee-payer/fee-payer.ui';
import { WalletButton } from '../solana/solana-provider';
import { AppHero, ellipsify } from '../ui/ui-layout';
import { useGetAccount } from './account-data-access';
import {
  AccountBalance,
  AccountButtons,
  AccountNFTs,
  AccountStakeAccounts,
  AccountTokens,
} from './account-ui';

export default function AccountDetailFeature() {
  const params = useParams();
  const address = useMemo(() => {
    if (!params.address) {
      return;
    }
    try {
      return new PublicKey(params.address);
    } catch (e) {}
  }, [params]);
  const query = useGetAccount({ address });
  const brickInfo = useMemo(
    () =>
      query.data && query.data.owner.toBase58() === TOKEN_PROGRAM_ID.toBase58()
        ? AccountLayout.decode(query.data.data)
        : undefined,
    [query.data]
  );

  const wallet = useWallet();
  const feePayer = useFeePayerContext();
  if (!address) {
    return <div>Error loading account</div>;
  }

  return (
    <div>
      <AppHero
        title={
          <div className="flex gap-2 items-center justify-center">
            <h2 className="text-xl font-bold">Compromised wallet:</h2>
            <WalletButton />
          </div>
        }
        subtitle={
          <div className="my-4">
            <ExplorerLink
              path={`account/${address.toBase58()}`}
              label={ellipsify(address.toBase58().toString())}
            />
          </div>
        }
      >
        {query.isFetched &&
          query.data?.owner &&
          query.data?.owner.toBase58() !==
            SystemProgram.programId.toBase58() && (
            <>
              <div className="bg-red-600 text-white">Bricked</div>
              {brickInfo && (
                <div>
                  Connect safe wallet {ellipsify(brickInfo.owner.toBase58())} to
                  unbrick
                </div>
              )}
            </>
          )}
        <AccountBalance address={address} />
        <div className="my-4">
          <AccountButtons
            address={address}
            canBrick={
              query.isFetched &&
              (!query.data ||
                query.data?.owner.toBase58() ===
                  SystemProgram.programId.toBase58())
            }
            canUnbrick={
              brickInfo?.owner.toBase58() === feePayer.publicKey?.toBase58()
            }
          />
        </div>
      </AppHero>
      <div className="space-y-2">
        <h2 className="text-2xl font-bold">Step 1: connect your safe wallet</h2>
        <FeePayerWalletButton />
        {wallet.publicKey &&
          feePayer.publicKey &&
          feePayer.publicKey.toBase58() !== wallet.publicKey.toBase58() && (
            <>
              <h2 className="text-2xl font-bold">
                Step 2: recover your assets
              </h2>
              <div>
                All assets and rent recovered will be sent to your safe wallet:{' '}
                <b>
                  <ExplorerLink
                    label={ellipsify(feePayer.publicKey.toBase58())}
                    path={`account/${feePayer.publicKey.toBase58()}`}
                  />
                </b>
              </div>
              <div className="space-y-8">
                <AccountTokens address={address} />
                <AccountNFTs address={address} />
                <AccountStakeAccounts address={address} />
                {/* <AccountTransactions address={address} /> */}
              </div>
            </>
          )}
      </div>
    </div>
  );
}
