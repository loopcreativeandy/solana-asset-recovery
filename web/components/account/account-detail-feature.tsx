'use client';

import { PublicKey, SystemProgram } from '@solana/web3.js';
import { useMemo } from 'react';

import { redirect, useParams } from 'next/navigation';

import { AccountLayout, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { ExplorerLink } from '../cluster/cluster-ui';
import { useCompromisedContext } from '../compromised/compromised.provider';
import { CompromisedWalletButton } from '../compromised/compromised.ui';
import { useFeePayerContext } from '../fee-payer/fee-payer.provider';
import { FeePayerWalletButton } from '../fee-payer/fee-payer.ui';
import { AppHero, AppModal, ellipsify } from '../ui/ui-layout';
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

  const wallet = useCompromisedContext();
  const feePayer = useFeePayerContext();

  if (
    address &&
    wallet.publicKey &&
    wallet.publicKey.toBase58() !== address.toBase58()
  ) {
    redirect(`/account/${wallet.publicKey.toBase58()}`);
  }

  if (!address) {
    return <div>Error loading account</div>;
  }

  return (
    <div className="max-w-7xl flex flex-col gap-2">
      <AppHero
        title="Account"
        subtitle="Recover assets from your compromised wallet"
        HelpModal={ModalHelp}
      >
        <div className="flex gap-2 items-center justify-center py-2">
          <h2 className="text-md font-bold">Compromised wallet:</h2>
          <CompromisedWalletButton />
        </div>
        <div className="flex flex-col gap-2">
          {query.isFetched &&
            query.data?.owner &&
            query.data?.owner.toBase58() !==
              SystemProgram.programId.toBase58() && (
              <>
                <div className="alert alert-warning items-center p-2 flex justify-center">
                  <b>Bricked</b>
                  {brickInfo && (
                    <div>
                      Connect safe wallet{' '}
                      <b>{ellipsify(brickInfo.owner.toBase58())}</b> to unbrick
                    </div>
                  )}
                </div>
              </>
            )}
          <AccountBalance address={address} />
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
      <div className="flex flex-col gap-2 border p-2">
        <h2 className="text-2xl font-bold">Step 1: Safe wallet</h2>
        <FeePayerWalletButton />
      </div>
      <div className="flex flex-col gap-2 border p-2">
        {wallet.publicKey &&
          feePayer.publicKey &&
          feePayer.publicKey.toBase58() !== wallet.publicKey.toBase58() && (
            <>
              <h2 className="text-2xl font-bold">Step 2: Recover</h2>
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

export function ModalHelp() {
  return (
    <AppModal
      title="Account"
      buttonLabel="?"
      buttonClassName="btn-sm btn-circle btn-neutral text-xl"
    >
      <div className="text-left">
        <div className="mb-2 italic text-lg">
          Recover assets from your compromised wallet to a safe one.
        </div>

        <summary>
          Connect your compromised wallet and safe wallet at Step 1
        </summary>
        <summary>
          Select the tokens, NFTs or stake accounts you're interested in
          recovering and send them to your safe wallet.
        </summary>
        <summary>
          Brick your wallet if your seed or private key was leaked. This will
          prevent others from being able to use it for transactions that
          requires this wallet to pay for rent (e.g. airdrop claims, close
          positions). Please note its functionality is quite limited and it
          won't stop from moving tokens or interacting with some protocols.
        </summary>
        <summary>
          Unbrick your wallet (if you previously bricked it) to become a regular
          wallet again.
        </summary>
      </div>
    </AppModal>
  );
}
