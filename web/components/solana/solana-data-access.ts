import {
  Commitment,
  Connection,
  SendOptions,
  Transaction,
  TransactionExpiredBlockheightExceededError,
  VersionedTransaction,
} from '@solana/web3.js';

export async function resendAndConfirmTransaction({
  connection,
  transaction,
  lastValidBlockHeight,
  signature,
  commitment = 'confirmed',
}: {
  connection: Connection;
  transaction: Transaction | VersionedTransaction;
  lastValidBlockHeight: number;
  signature: string;
  commitment?: Commitment;
}) {
  const options: SendOptions = {
    maxRetries: 0,
    skipPreflight: true,
  };
  let retries = 0;
  const getBackoff = (retries: number) => 1000 * (1 + 2 * retries);
  let blockHeight = await connection.getBlockHeight(commitment);
  do {
    await sleep(getBackoff(retries));

    const status = await connection.getSignatureStatus(signature);
    if (status?.value) {
      if (status.value.err) {
        throw status.value.err;
      }
      return signature;
    }

    if (transaction instanceof VersionedTransaction) {
      signature = await connection.sendTransaction(transaction, options);
    } else {
      signature = await connection.sendRawTransaction(
        transaction.serialize(),
        options
      );
    }

    retries++;
    if (retries >= 10) {
      blockHeight = await connection.getBlockHeight(commitment);
    }
  } while (blockHeight < lastValidBlockHeight);

  throw new TransactionExpiredBlockheightExceededError(signature);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
