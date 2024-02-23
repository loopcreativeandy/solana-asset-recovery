'use client';

import { useState } from 'react';
import { AppHero } from '../ui/ui-layout';
import Head from 'next/head';
import { TransactionUi } from './transactions-ui';
import { useWallet } from '@solana/wallet-adapter-react';


export default function TransactionsFeature() {

  return (
    <div>
      <AppHero
        title="Transactions"
        subtitle="Manually send transactions from bricked wallets"
      >
        <TransactionUi></TransactionUi>
      </AppHero>
    </div>
  );
}
