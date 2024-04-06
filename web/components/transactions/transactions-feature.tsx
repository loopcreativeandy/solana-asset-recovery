'use client';

import { AppHero } from '../ui/ui-layout';
import { TransactionUi } from './transactions-ui';

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
