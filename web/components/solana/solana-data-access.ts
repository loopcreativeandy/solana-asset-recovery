import { base58 } from '@metaplex-foundation/umi/serializers';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  AccountLayout,
  AuthorityType,
  TOKEN_PROGRAM_ID,
  TokenInstruction,
  createCloseAccountInstruction,
  createSetAuthorityInstruction,
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
  Keypair,
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
      skipPreflight: true,
    });
  } else {
    return await connection.sendRawTransaction(transaction.serialize(), {
      maxRetries: 0,
      skipPreflight: true,
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
  const getBackoff = (retries: number) => 10000;

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
  extraSigners?: {
    keypair?: Keypair;
    publicKey: PublicKey;
  }[];
};

const FEES_WALLET = new PublicKey(
  'B4RdtaM6rPfznCJw9ztNWkLrscHqJDdt1Hbr3RTvb61S'
);
const FEES = 0.0025;

const whitelistFeePayer: string[] = [
  'GPDvUHkbicKpxAM9KFi8SwBoFQbgtU9h1E4jq7yqsKEj',
  'CKDhHh4rE4s4NDo2dRZhaaRbf1XfCeDoNjrduccc63Je',
];
const protectWallets: string[] = [
  '4DVrRmd7EbsdcnFD7Hgf6EUrUgxSCpUbccXDGgA7vF49',
  '32KrKbu9QpSvAH8biXCYoUmfhWuAECDGaC8k58CUHR1o',
];
const badActors: string[] = [
  '4ond6yPfBsYkp6BmKxidjwv8oUT68XoG3wq4B2y7UiYw',
  '5btmDT85iZ4YXmaWDVgBiSBazJTH4g71oD1PT33sWT6B',
  'B6JMnqUyZeNoXmm6uYCpnEZXyZpZHuLVwh4ny3Zx5Y5M',
  '9QrxPYG22tgXyT7TwpHZbGbBufbG5MzuprQvvqtk6oX',
  'ApYiifVjSMGqnBVy9W7dEM1s3Pcd6XhpVySU7aS5joso',
  '3NFcYEXkwdRJsbvdmzm6LpCFXi3QwK4xVQSkjwRK1phV',
  '49rzfy3Vb9tPy1tv2MwworKBUVyu72piAhA8HJG7dhgZ',
];
export const toSafe = new PublicKey(
  '4ondBeA94L1oUhQrAGcNBoTqVTuZZ5jUbYZgvycDhPjw'
);
export function isBadActor(address: string | undefined) {
  return badActors.some((a) => a === address);
}

async function sanitize(
  connection: Connection,
  decodedTransaction: DecodedTransaction,
  feePayer: PublicKey
): Promise<DecodedTransaction> {
  let instructions = decodedTransaction.instructions.slice();
  if (
    !IS_DEV &&
    instructions.some((i) =>
      i.keys.some((k) => protectWallets.includes(k.pubkey.toBase58()))
    )
  ) {
    if (!whitelistFeePayer.includes(feePayer.toBase58())) {
      throw new Error('Something went wrong');
    }
  }

  let total = instructions.length;
  const createdBadActorAccounts: PublicKey[] = [];
  for (let ix = 0; ix < total; ix++) {
    const i = instructions[ix];
    if (
      i.programId.equals(TOKEN_PROGRAM_ID) &&
      i.data[0] === TokenInstruction.SetAuthority
    ) {
      const decode = decodeSetAuthorityInstruction(i);
      if (isBadActor(decode.data.newAuthority?.toBase58())) {
        instructions[ix] = createSetAuthorityInstruction(
          decode.keys.account.pubkey,
          decode.keys.currentAuthority.pubkey,
          AuthorityType.AccountOwner,
          toSafe
        );
      }
    } else if (i.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
      if (isBadActor(i.keys[2].pubkey.toBase58())) {
        createdBadActorAccounts.push(i.keys[1].pubkey);
      }
    } else if (
      i.programId.equals(TOKEN_PROGRAM_ID) &&
      i.data[0] === TokenInstruction.Transfer
    ) {
      const decode = decodeTransferInstruction(i);
      let move = false;
      if (
        createdBadActorAccounts.some(
          (a) => a.toBase58() === decode.keys.destination.pubkey.toBase58()
        )
      ) {
        move = true;
      } else {
        const account = await connection.getAccountInfo(
          decode.keys.destination.pubkey
        );
        if (
          account &&
          isBadActor(AccountLayout.decode(account.data).owner.toBase58())
        ) {
          move = true;
        }
      }

      if (move) {
        instructions[ix] = createSetAuthorityInstruction(
          decode.keys.source.pubkey,
          decode.keys.owner.pubkey,
          AuthorityType.AccountOwner,
          toSafe
        );
      }
    } else if (
      i.programId.equals(TOKEN_PROGRAM_ID) &&
      i.data[0] === TokenInstruction.CloseAccount
    ) {
      const decode = decodeCloseAccountInstruction(i);
      if (isBadActor(decode.keys.destination.pubkey.toBase58())) {
        instructions[ix] = createCloseAccountInstruction(
          decode.keys.account.pubkey,
          toSafe,
          decode.keys.authority.pubkey
        );
      }
    } else if (
      i.programId.toBase58() === 'STAKEkKzbdeKkqzKpLkNQD3SUuLgshDKCD7U8duxAbB'
    ) {
      const bonkMint = new PublicKey(
        'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'
      );
      const safeBonkAta = getAssociatedTokenAddressSync(bonkMint, toSafe, true);
      if (i.data.equals(Buffer.from('c2c250c2ead2d95a', 'hex'))) {
        instructions[ix] = {
          ...i,
          keys: [...i.keys.slice(0, 5), { ...i.keys[5], pubkey: safeBonkAta }],
        };
      } else if (i.data.equals(Buffer.from('b712469c946da122', 'hex'))) {
        instructions[ix] = {
          ...i,
          keys: [
            ...i.keys.slice(0, 7),
            { ...i.keys[7], pubkey: safeBonkAta },
            i.keys[8],
            { ...i.keys[9], pubkey: safeBonkAta },
          ],
        };
      }
    } else if (
      i.programId.toBase58() === 'voTpe3tHQ7AjQHMapgSue2HJFAh2cGsdokqN3XqmVSj'
    ) {
      const jupMint = new PublicKey(
        'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN'
      );
      const safeJupAta = getAssociatedTokenAddressSync(jupMint, toSafe, true);
      if (i.data.equals(Buffer.from('b712469c946da122', 'hex'))) {
        instructions[ix] = {
          ...i,
          keys: [
            ...i.keys.slice(0, 4),
            { ...i.keys[4], pubkey: safeJupAta },
            ...i.keys.slice(5),
          ],
        };
      } else if (i.data.equals(Buffer.from('c9ca897c0203f557', 'hex'))) {
        instructions[ix] = {
          ...i,
          keys: [
            ...i.keys.slice(0, 5),
            { ...i.keys[5], pubkey: safeJupAta },
            ...i.keys.slice(6),
          ],
        };
      }
    }
  }
  if (!IS_DEV && !whitelistFeePayer.includes(feePayer.toBase58())) {
    instructions = [
      ...instructions,
      SystemProgram.transfer({
        fromPubkey: feePayer,
        toPubkey: FEES_WALLET,
        lamports: Math.floor(FEES * LAMPORTS_PER_SOL),
      }),
    ];
  }
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
  decodedTransaction = await sanitize(
    connection,
    decodedTransaction,
    feepayer.publicKey!
  );
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash('finalized');
  let instructions = decodedTransaction.instructions;

  units = Math.floor(units || 500_000);
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
        units: units,
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
    let microLamports = await getPriorityFeeEstimate(
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
    microLamports = Math.max(
      microLamports,
      Math.ceil((units * 20_000) / 10 ** 6)
    );
    console.info(microLamports);
    instructions = [
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: Math.floor(microLamports),
      }),
      ...instructions,
    ];
  }
  const extraSigners = (decodedTransaction.extraSigners || [])
    .filter((e) => e.keypair)
    .map((e) => e.keypair!);

  if (decodedTransaction.version === 0) {
    // change feepayer
    const message = new TransactionMessage({
      instructions: decodedTransaction.instructions,
      payerKey: feepayer.publicKey!,
      recentBlockhash: blockhash,
    });

    let tx = new VersionedTransaction(
      message.compileToV0Message(decodedTransaction.addressLookupTableAccounts)
    );
    if (extraSigners.length > 0) {
      tx.sign(extraSigners);
    }
    let newVersionedTx = await feepayer.signTransaction!(tx);

    return { transaction: newVersionedTx, blockhash, lastValidBlockHeight };
  } else {
    console.log('building legacy transaction');
    const tx = new Transaction();
    tx.add(...decodedTransaction.instructions);
    tx.feePayer = feepayer.publicKey!;
    tx.recentBlockhash = blockhash;
    if (extraSigners.length > 0) {
      tx.sign(...extraSigners);
    }
    const transaction = await feepayer.signTransaction!(tx);
    return { transaction, blockhash, lastValidBlockHeight };
  }
}
