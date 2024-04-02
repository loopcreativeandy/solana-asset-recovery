'use client';

import { useState } from 'react';
import { AppHero, AppModal } from '../ui/ui-layout';
import { TransactionUi } from './transactions-ui';

export default function TransactionsFeature() {
  return (
    <div>
      <AppHero
        title="Transactions"
        subtitle="Manually send transactions from bricked wallets"
      >
        <ModalHelp />
        <TransactionUi></TransactionUi>
      </AppHero>
    </div>
  );
}

function ModalHelp() {
  const [show, setShow] = useState(false);

  return (
    <>
      <button
        className="btn btn-circle btn-info text-2xl fixed top-20 right-2"
        onClick={() => setShow(true)}
      >
        ?
      </button>
      <AppModal hide={() => setShow(false)} show={show} title="Transactions">
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
            Send the transaction and await for confirmation. Check the
            transaction shown.
          </summary>
        </div>
      </AppModal>
    </>
  );
}
