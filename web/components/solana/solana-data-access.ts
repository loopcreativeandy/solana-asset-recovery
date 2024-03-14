import { base58 } from '@metaplex-foundation/umi/serializers';
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
  const getBackoff = (retries: number) => 1000 * (1 + 1 * retries);
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

export enum PriorityLevel {
  Default = 'Default',
  None = 'None',
  Low = 'Low',
  Medium = 'Medium',
  High = 'High',
  VeryHigh = 'VeryHigh',
}

export async function getPriorityFeeEstimate(
  rpc: string,
  transaction: VersionedTransaction,
  priorityLevel: PriorityLevel
) {
  const response = await fetch(rpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: '1',
      method: 'getPriorityFeeEstimate',
      params: [
        {
          transaction: base58.deserialize(transaction.serialize())[0],
          options: { priorityLevel },
        },
      ],
    }),
  });
  const data = await response.json();
  console.log(
    'Fee in function for',
    priorityLevel,
    ' :',
    data.result.priorityFeeEstimate
  );
  return data.result.priorityFeeEstimate as number;
}
