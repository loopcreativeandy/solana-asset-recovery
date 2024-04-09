import { base58 } from '@metaplex-foundation/umi/serializers';
import {
  Commitment,
  Connection,
  SendOptions,
  Transaction,
  VersionedTransaction,
} from '@solana/web3.js';

export async function resendAndConfirmTransaction({
  connection,
  transaction,
  signature,
  blockhash,
  lastValidBlockHeight,
  commitment = 'confirmed',
}: {
  connection: Connection;
  transaction: Transaction | VersionedTransaction;
  signature: string;
  blockhash: string;
  lastValidBlockHeight: number;
  commitment?: Commitment;
}) {
  const options: SendOptions = {
    maxRetries: 0,
    skipPreflight: true,
  };
  let retries = 0;
  const getBackoff = (retries: number) => 2000;

  const result = { done: false };
  try {
    await Promise.race([
      connection.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        commitment
      ),
      new Promise(async () => {
        while (!result.done) {
          await sleep(getBackoff(retries));
          if (transaction instanceof VersionedTransaction) {
            signature = await connection.sendTransaction(transaction, options);
          } else {
            signature = await connection.sendRawTransaction(
              transaction.serialize(),
              options
            );
          }
        }
      }),
    ]);
  } finally {
    result.done = true;
  }
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
