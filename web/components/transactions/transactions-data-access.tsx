'use client';

import { uniqueBy } from '@metaplex-foundation/umi';
import { base64 } from '@metaplex-foundation/umi/serializers';
import {
  ACCOUNT_SIZE,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  AccountLayout,
  MINT_SIZE,
  MintLayout,
  RawAccount,
  RawMint,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { WalletContextState } from '@solana/wallet-adapter-react';
import {
  AccountInfo,
  AddressLookupTableAccount,
  ComputeBudgetInstruction,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SignaturePubkeyPair,
  SimulatedTransactionAccountInfo,
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
  let isVersionedTx: number;
  let serialTx: Uint8Array;
  try {
    const decodedMessage = bs58.decode(payload);
    isVersionedTx = decodedMessage[0] & 128;
    const emptySignature = new Uint8Array(1 + 64);
    emptySignature[0] = 1;

    serialTx = new Uint8Array(emptySignature.length + decodedMessage.length);
    serialTx.set(emptySignature, 0),
      serialTx.set(decodedMessage, emptySignature.length);
  } catch (err: any) {
    serialTx = base64.serialize(payload);
    const signers = serialTx[0];
    isVersionedTx = serialTx[1 + signers * 64] & 128;
  }

  let decoded: DecodedTransaction;
  if (isVersionedTx) {
    console.log('building versioned transaction');
    VersionedTransaction.deserialize(serialTx);
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

export function move<T>(arr: T[], index: number, offset: number) {
  let items = arr.splice(index, 1);
  arr.splice(index + offset, 0, ...items);
  return arr;
}

export type SimulateResult = SimulatedTransactionResponse & {
  addresses: {
    pubkey: string;
    type?: 'token-account' | 'mint';
    tokenAccount?: RawAccount;
    mint?: RawMint;
    owner?: PublicKey;
    before: {
      authority?: PublicKey;
      tokenAmount?: number;
      lamports: number;
    };
    after: {
      authority?: PublicKey;
      tokenAmount?: number;
      lamports: number;
    };
    writable: boolean;
  }[];
};

export async function simulateTransaction(
  connection: Connection,
  decodedTransaction: DecodedTransaction,
  payerKey: PublicKey
): Promise<SimulateResult> {
  const { blockhash } = await connection.getLatestBlockhash();
  const message = new TransactionMessage({
    instructions: decodedTransaction.instructions,
    payerKey,
    recentBlockhash: blockhash,
  });

  const tx = new VersionedTransaction(
    message.compileToV0Message(decodedTransaction.addressLookupTableAccounts)
  );

  const addresses = uniqueBy(
    [
      ...tx.message.staticAccountKeys,
      ...tx.message.addressTableLookups.flatMap((a, ix) =>
        [...a.writableIndexes, ...a.readonlyIndexes].map(
          (w) =>
            decodedTransaction.addressLookupTableAccounts!.find(
              (l) => l.key.toBase58() === a.accountKey.toBase58()
            )!.state.addresses[w]
        )
      ),
    ],
    (a, b) => a === b
  );

  function parseAccount(
    acc:
      | AccountInfo<Buffer>
      | SimulatedTransactionAccountInfo
      | null
      | undefined
  ):
    | null
    | (Pick<AccountInfo<Buffer>, 'owner' | 'lamports'> &
        (
          | { type: undefined }
          | { type: 'token-account'; acc: RawAccount }
          | { type: 'mint'; acc: RawMint }
        )) {
    if (!acc) {
      return null;
    }
    let { owner, data, lamports } = acc;
    owner = owner instanceof PublicKey ? owner : new PublicKey(acc.owner);
    const dataUint =
      typeof (data as string[])?.at(0) === 'string'
        ? base64.serialize((data as string[])[0])
        : (data as Buffer);
    if (owner.equals(TOKEN_PROGRAM_ID) && dataUint.length === ACCOUNT_SIZE) {
      return {
        owner,
        lamports,
        type: 'token-account',
        acc: AccountLayout.decode(dataUint),
      };
    } else if (
      owner.equals(TOKEN_PROGRAM_ID) &&
      dataUint.length === MINT_SIZE
    ) {
      return {
        owner,
        lamports,
        type: 'mint',
        acc: MintLayout.decode(dataUint),
      };
    }
    return {
      owner: new PublicKey(owner),
      lamports,
      type: undefined,
    };
  }
  const before = await connection.getMultipleAccountsInfo(addresses);
  const { value: result } = await connection.simulateTransaction(tx, {
    replaceRecentBlockhash: true,
    sigVerify: false,
    accounts: {
      encoding: 'base64',
      addresses: addresses.map((a) => a.toBase58()),
    },
  });

  return {
    ...result,
    addresses: addresses.map((pubkey, ix) => {
      const beforeAcc = parseAccount(before[ix]);
      const afterAcc = parseAccount(result.accounts?.[ix]);
      let owner =
        beforeAcc?.type === 'token-account'
          ? beforeAcc.owner
          : afterAcc?.type === 'token-account'
          ? afterAcc.owner
          : beforeAcc?.owner || afterAcc?.owner;
      return {
        pubkey: pubkey.toBase58(),
        type: beforeAcc?.type || afterAcc?.type,
        mint:
          (beforeAcc?.type === 'mint' && beforeAcc.acc) ||
          (afterAcc?.type === 'mint' && afterAcc.acc) ||
          undefined,
        tokenAccount:
          (beforeAcc?.type === 'token-account' && beforeAcc.acc) ||
          (afterAcc?.type === 'token-account' && afterAcc.acc) ||
          undefined,
        owner,
        before: {
          authority:
            beforeAcc?.type === 'token-account'
              ? beforeAcc.acc.owner
              : undefined,
          tokenAmount:
            beforeAcc?.type === 'token-account'
              ? Number(beforeAcc.acc.amount)
              : undefined,
          lamports: beforeAcc?.lamports || 0,
        },
        after: {
          authority:
            afterAcc?.type === 'token-account' ? afterAcc.acc.owner : undefined,
          tokenAmount:
            afterAcc?.type === 'token-account'
              ? Number(afterAcc.acc.amount)
              : undefined,
          lamports: afterAcc?.lamports || 0,
        },
        writable: decodedTransaction.instructions.some((i) =>
          i.keys.some(
            (a) => a.pubkey.toBase58() === pubkey.toBase58() && a.isWritable
          )
        ),
      };
    }),
  };
}

export async function buildTransactionFromPayload(
  connection: Connection,
  decodedTransaction: DecodedTransaction,
  feepayer: WalletContextState,
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
