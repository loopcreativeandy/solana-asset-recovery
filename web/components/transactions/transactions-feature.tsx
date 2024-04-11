'use client';

import { CompromisedWalletButton } from '../compromised/compromised.ui';
import { AppHero, AppModal } from '../ui/ui-layout';
import { TransactionUi } from './transactions-ui';

export default function TransactionsFeature() {
  return (
    <div>
      <AppHero
        title="Transactions"
        subtitle="Manually send transactions from bricked wallets"
        HelpModal={ModalHelp}
      >
        <div className="flex gap-2 items-center justify-center">
          <h2 className="text-md font-bold">Compromised wallet:</h2>
          <CompromisedWalletButton />
        </div>
      </AppHero>
      <TransactionUi />
    </div>
  );
}

function ModalHelp() {
  return (
    <AppModal
      title="Transactions"
      buttonLabel="?"
      buttonClassName="btn-sm btn-circle btn-neutral text-xl"
    >
      <div className="text-left">
        <div className="mb-2 italic text-lg">
          Grab a transaction from another website and build it using the safe
          wallet as the fee payer.
        </div>
        <summary>
          Connect your compromised wallet and safe wallet at Step 1.
        </summary>
        <summary>
          Grab the payload from the website using Solflare wallet at Step 2.{' '}
          <a href="https://youtu.be/4TLF_Qi154k?t=55" target="_blank">
            How?
          </a>
        </summary>
        <summary>
          Add, move, delete or change accounts for instructions at Step 3, to
          make more advanced scenarios that would fail for bricked wallets or
          else.
        </summary>
        <summary>
          Check the result of the simulation at Step 4. Also look at account
          changes on what token or SOL balance would increment/decrement.
          Remember checking these accounts are owned by yourself and were not
          taken.
        </summary>
        <summary>
          Send the transaction and await for confirmation. Check the transaction
          shown.
        </summary>
      </div>
    </AppModal>
  );
}
