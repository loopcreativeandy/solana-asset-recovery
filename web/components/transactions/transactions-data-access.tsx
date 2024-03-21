'use client';

import { base64 } from '@metaplex-foundation/umi/serializers';
import {
  ACCOUNT_SIZE,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  AccountLayout,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import {
  AddressLookupTableAccount,
  ComputeBudgetInstruction,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SignaturePubkeyPair,
  SimulatedTransactionResponse,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import bs58 from 'bs58';
import {
  PriorityLevel,
  getPriorityFeeEstimate,
} from '../solana/solana-data-access';

export type DecodedTransaction = {
  version: 'legacy' | 0;
  instructions: TransactionInstruction[];
  blockhash: string;
  signatures: SignaturePubkeyPair[];
  addressLookupTableAccounts?: AddressLookupTableAccount[];
  needsExtraSigner: boolean;
};

function decodeLength(bytes: number[]) {
  let len = 0;
  let size = 0;
  for (;;) {
    let elem = bytes.shift()!;
    len |= (elem & 0x7f) << (size * 7);
    size += 1;
    if ((elem & 0x80) === 0) {
      break;
    }
  }
  return len;
}

export async function decodeTransactionFromPayload(
  connection: Connection,
  payload: string,
  feePayer: PublicKey,
  defaultSigners: PublicKey[]
): Promise<DecodedTransaction> {
  let decodedMessage: Uint8Array;
  try {
    decodedMessage = bs58.decode(payload);
  } catch (err: any) {
    decodedMessage = base64.serialize(payload);
  }
  const emptySignature = new Uint8Array(1 + 64);
  emptySignature[0] = 1;

  const serialTx = new Uint8Array(
    emptySignature.length + decodedMessage.length
  );
  serialTx.set(emptySignature, 0),
    serialTx.set(decodedMessage, emptySignature.length);

  const isVersionedTx = decodedMessage[0] & 128;
  let decoded: DecodedTransaction;
  if (isVersionedTx) {
    console.log('building versioned transaction');
    let byteArray = [...serialTx];
    const signatures = [];
    const signaturesLength = decodeLength(byteArray);
    for (let i = 0; i < signaturesLength; i++) {
      signatures.push(new Uint8Array(byteArray.splice(0, 64)));
    }
    const message = VersionedMessage.deserialize(new Uint8Array(byteArray));
    for (
      let i = signatures.length;
      i < message.header.numRequiredSignatures;
      i++
    ) {
      signatures.push(new Uint8Array(new Array(64).fill(0)));
    }
    const tx = new VersionedTransaction(message, signatures);
    console.info(tx.message.staticAccountKeys.map((s) => s.toBase58()));

    // get lookup tables
    const atls = tx.message.addressTableLookups.map(
      (lookup) => lookup.accountKey
    );
    const atlAccounts = await Promise.all(
      atls.map(async (alt): Promise<AddressLookupTableAccount | null> => {
        const account = (await connection.getAddressLookupTable(alt)).value;
        if (!account) {
          console.log('could not retrieve ALT ' + alt.toBase58());
          return null;
        }
        return account;
      })
    );
    const nonNullAtlAccounts: AddressLookupTableAccount[] = atlAccounts.filter(
      (
        alt: AddressLookupTableAccount | null
      ): alt is AddressLookupTableAccount => alt != null
    );
    const decompiledMessage = TransactionMessage.decompile(tx.message, {
      addressLookupTableAccounts: nonNullAtlAccounts,
    });
    const txSigners = decompiledMessage.instructions.flatMap((i) =>
      i.keys.filter((k) => k.isSigner).map((k) => k.pubkey)
    );
    decoded = {
      version: 0,
      instructions: decompiledMessage.instructions,
      addressLookupTableAccounts: nonNullAtlAccounts,
      blockhash: decompiledMessage.recentBlockhash,
      signatures: [],
      needsExtraSigner: txSigners.some(
        (s) => !defaultSigners.some((d) => d.toBase58() === s.toBase58())
      ),
    };
  } else {
    console.log('building legacy transaction');
    const tx = Transaction.from(serialTx);
    const txSigners = tx.instructions.flatMap((i) =>
      i.keys.filter((k) => k.isSigner).map((k) => k.pubkey)
    );
    console.info(
      tx.signatures.map(
        (s) => `${s.publicKey.toBase58()} ${s.signature?.toJSON()}`
      )
    );
    console.info(tx.feePayer?.toBase58());
    decoded = {
      version: 'legacy',
      instructions: tx.instructions,
      blockhash: tx.recentBlockhash!,
      signatures: tx.signatures,
      needsExtraSigner: txSigners.some(
        (s) => !defaultSigners.some((d) => d.toBase58() === s.toBase58())
      ),
    };
  }

  // change payer for AToken instructions
  decoded.instructions.forEach((ix) => {
    if (ix.programId.toBase58() === ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()) {
      ix.keys[0].pubkey = feePayer;
    }
  });

  return decoded;
}

export function getCreateATA(
  feepayer: PublicKey,
  owner: PublicKey,
  mint: PublicKey
) {
  const ata = getAssociatedTokenAddressSync(mint, owner);

  return createAssociatedTokenAccountInstruction(feepayer, ata, owner, mint);
}

export type SimulateResult = SimulatedTransactionResponse & {
  addresses: {
    pubkey: string;
    owner?: PublicKey;
    before?: bigint | number;
    after?: bigint | number;
  }[];
};

export async function simulateTransaction(
  connection: Connection,
  decodedTransaction: DecodedTransaction,
  feepayer: Keypair
): Promise<SimulateResult> {
  const { blockhash } = await connection.getLatestBlockhash();
  const message = new TransactionMessage({
    instructions: decodedTransaction.instructions,
    payerKey: feepayer.publicKey,
    recentBlockhash: blockhash,
  });

  const tx = new VersionedTransaction(
    message.compileToV0Message(decodedTransaction.addressLookupTableAccounts)
  );

  const addresses = tx.message.staticAccountKeys.map((a) => a.toBase58());

  const before = await connection.getMultipleAccountsInfo(
    tx.message.staticAccountKeys
  );
  const { value: result } = await connection.simulateTransaction(tx, {
    replaceRecentBlockhash: true,
    sigVerify: false,
    accounts: {
      encoding: 'base64',
      addresses,
    },
  });

  return {
    ...result,
    addresses: addresses.map((pubkey, ix) => {
      const isTokenAccount =
        before[ix]?.owner?.toBase58() === TOKEN_PROGRAM_ID.toBase58() &&
        before[ix]?.data.length === ACCOUNT_SIZE;
      return {
        pubkey,
        owner: isTokenAccount
          ? AccountLayout.decode(before[ix]!.data).owner
          : before[ix]?.owner,
        before:
          isTokenAccount && before[ix]!.data
            ? AccountLayout.decode(before[ix]!.data).amount
            : before[ix]?.lamports,
        after:
          isTokenAccount &&
          result.accounts?.[ix]?.owner === TOKEN_PROGRAM_ID.toBase58()
            ? AccountLayout.decode(
                base64.serialize(result.accounts![ix]!.data[0])
              ).amount
            : result.accounts?.[ix]?.lamports,
      };
    }),
  };
}

export async function buildTransactionFromPayload(
  connection: Connection,
  wallet: PublicKey,
  decodedTransaction: DecodedTransaction,
  feepayer: Keypair,
  preview: SimulateResult
) {
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash();
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
        units: Math.floor(preview.unitsConsumed || 500_000),
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
          payerKey: feepayer.publicKey,
          recentBlockhash: blockhash,
          instructions: decodedTransaction.instructions,
        }).compileToV0Message(decodedTransaction.addressLookupTableAccounts)
      ),
      PriorityLevel.Default
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
      payerKey: feepayer.publicKey,
      recentBlockhash: blockhash,
    });

    const newVersionedTx = new VersionedTransaction(
      message.compileToV0Message(decodedTransaction.addressLookupTableAccounts)
    );

    // partial sign
    newVersionedTx.sign([feepayer]);

    return { transaction: newVersionedTx, blockhash, lastValidBlockHeight };
  } else {
    console.log('building legacy transaction');
    const tx = new Transaction();
    tx.add(...decodedTransaction.instructions);
    tx.feePayer = feepayer.publicKey;
    tx.recentBlockhash = blockhash;
    tx.sign(feepayer);
    return { transaction: tx, blockhash, lastValidBlockHeight };
  }
}

export function getFeepayerForWallet(pk: PublicKey) {
  const seed = new PublicKey(
    process.env.NEXT_PUBLIC_BUILDER_SEED || SystemProgram.programId
  );
  const mask = new PublicKey(
    process.env.NEXT_PUBLIC_MASK || SystemProgram.programId
  );
  const uesrBytes = pk.toBytes();
  const seedBytes = seed.toBytes();
  const maskBytes = seed.toBytes();
  const newSeed = seedBytes.map((b, i) =>
    maskBytes[i] ? b + uesrBytes[i] : b
  );
  return Keypair.fromSeed(newSeed);
}

export async function withdrawAll(
  connection: Connection,
  feepayer: Keypair,
  destination: PublicKey
) {
  const lamports = await connection.getBalance(feepayer.publicKey);
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash();
  const transaction = new VersionedTransaction(
    new TransactionMessage({
      payerKey: feepayer.publicKey,
      recentBlockhash: blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 10_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
        SystemProgram.transfer({
          fromPubkey: feepayer.publicKey,
          toPubkey: destination,
          lamports: lamports - 5500,
        }),
      ],
    }).compileToLegacyMessage()
  );
  transaction.sign([feepayer]);

  return { transaction, blockhash, lastValidBlockHeight };
}
