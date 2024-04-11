import { base58 } from '@metaplex-foundation/umi/serializers';
import {
  AddressLookupTableAccount,
  Commitment,
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SendOptions,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';

export function getTransaction({
  payer,
  instructions,
  blockhash,
  units,
  microLamports,
  addressLookupTableAccounts,
}: {
  payer: PublicKey;
  instructions: TransactionInstruction[];
  blockhash: string;
  units?: number;
  microLamports?: number;
  addressLookupTableAccounts?: AddressLookupTableAccount[];
}) {
  instructions = [...instructions];
  if (microLamports) {
    instructions.unshift(
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports })
    );
  }
  instructions.unshift(
    ComputeBudgetProgram.setComputeUnitLimit({ units: units || 1_400_000 })
  );

  const message = new TransactionMessage({
    payerKey: payer,
    instructions,
    recentBlockhash: blockhash,
  });
  let versionedMessage = addressLookupTableAccounts
    ? message.compileToV0Message(addressLookupTableAccounts)
    : message.compileToLegacyMessage();
  return new VersionedTransaction(versionedMessage);
}

export async function getRequiredComputeUnits(
  connection: Connection,
  payer: PublicKey,
  instructions: TransactionInstruction[],
  blockhash: string
) {
  const transaction = getTransaction({
    payer,
    instructions,
    blockhash,
  });
  const sim = await connection.simulateTransaction(transaction, {
    replaceRecentBlockhash: true,
    sigVerify: false,
  });
  if (sim.value.err) {
    return 1_400_000;
  }
  return Math.floor((sim.value.unitsConsumed || 600_000) * 1.1);
}

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
  if (rpc.includes('helius')) {
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
  } else {
    const priorityFees: Record<PriorityLevel, number> = {
      [PriorityLevel.None]: 0,
      [PriorityLevel.Low]: 10_000,
      [PriorityLevel.Medium]: 50_000,
      [PriorityLevel.Default]: 100_000,
      [PriorityLevel.High]: 300_000,
      [PriorityLevel.VeryHigh]: 500_000,
    };
    return priorityFees[priorityLevel];
  }
}
