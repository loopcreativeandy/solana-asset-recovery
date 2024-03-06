'use client';

import {
  AddressLookupTableAccount,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import bs58 from 'bs58';

export type DecodedTransaction = {
  version: 'legacy' | 0;
  instructions: TransactionInstruction[];
  addressLookupTableAccounts?: AddressLookupTableAccount[];
};

export async function decodeTransactionFromPayload(
  connection: Connection,
  payload: string
): Promise<DecodedTransaction> {
  const decodedMessage = bs58.decode(payload);
  const emptySignature = new Uint8Array(1 + 64);
  emptySignature[0] = 1;

  const serialTx = new Uint8Array(
    emptySignature.length + decodedMessage.length
  );
  serialTx.set(emptySignature, 0),
    serialTx.set(decodedMessage, emptySignature.length);

  const isVersionedTx = decodedMessage[0] & 128;
  if (isVersionedTx) {
    console.log('building versioned transaction');
    const tx = VersionedTransaction.deserialize(serialTx);

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
    return {
      version: 0,
      instructions: decompiledMessage.instructions,
      addressLookupTableAccounts: nonNullAtlAccounts,
    };
  } else {
    console.log('building legacy transaction');
    const tx = Transaction.from(serialTx);
    return { version: 'legacy', instructions: tx.instructions };
  }
}

export async function simulateTransaction(
  connection: Connection,
  decodedTransaction: DecodedTransaction,
  feepayer: Keypair
) {
  const { blockhash } = await connection.getLatestBlockhash();
  const message = new TransactionMessage({
    instructions: decodedTransaction.instructions,
    payerKey: feepayer.publicKey,
    recentBlockhash: blockhash,
  });

  const tx = new VersionedTransaction(
    message.compileToV0Message(decodedTransaction.addressLookupTableAccounts)
  );

  const { value: result } = await connection.simulateTransaction(tx, {
    replaceRecentBlockhash: true,
    sigVerify: false,
  });

  return result;
}

export async function buildTransactionFromPayload(
  connection: Connection,
  decodedTransaction: DecodedTransaction,
  feepayer: Keypair,
  publicKey: PublicKey
) {
  const { blockhash } = await connection.getLatestBlockhash();
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

    return newVersionedTx;
  } else {
    console.log('building legacy transaction');
    const tx = new Transaction();
    tx.add(...decodedTransaction.instructions);
    tx.feePayer = feepayer.publicKey;
    tx.recentBlockhash = blockhash;
    tx.sign(feepayer);
    return tx;
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
