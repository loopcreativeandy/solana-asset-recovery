'use client';

import { AddressLookupTableAccount, Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";


export async function buildTransactionFromPayload(connection: Connection, payload: string, feepayer: Keypair, publicKey: PublicKey){
  
  const decodedMessage = bs58.decode(payload);
  const emptySignature = new Uint8Array(1+64);
  emptySignature[0] = 1;

  const serialTx = new Uint8Array(emptySignature.length+decodedMessage.length)
  serialTx.set(emptySignature, 0),
  serialTx.set(decodedMessage, emptySignature.length)

  const isVersionedTx = decodedMessage[0] & 128;
  if(isVersionedTx){
    console.log("building versioned transaction" )
    const tx = VersionedTransaction.deserialize(serialTx)
    
    // get lookup tables
    const atls = tx.message.addressTableLookups.map(lookup => lookup.accountKey);
    const atlAccounts = await Promise.all(atls.map(async (alt):Promise<AddressLookupTableAccount|null>=>{
        const account = (await connection.getAddressLookupTable(alt)).value;
        if(!account){
            console.log("could not retrieve ALT "+alt.toBase58());
            return null;
        }
        return account;
    }));
    const nonNullAtlAccounts : AddressLookupTableAccount[] = atlAccounts.filter((alt: AddressLookupTableAccount|null): alt is AddressLookupTableAccount=>alt!=null);

    // change feepayer 
    const decompiledMessage = TransactionMessage.decompile(tx.message, {
        addressLookupTableAccounts: nonNullAtlAccounts
    });
    decompiledMessage.payerKey = feepayer.publicKey;
    decompiledMessage.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    const newVersionedTx = new VersionedTransaction(decompiledMessage.compileToV0Message(atlAccounts));

    // partial sign
    newVersionedTx.sign([feepayer])
    
    return newVersionedTx;
  } else {
    console.log("building legacy transaction")
    const tx = Transaction.from(serialTx);
    tx.feePayer = feepayer.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    tx.sign(feepayer);
    return tx;
  }
}

export function getFeepayerForWallet(pk: PublicKey){
  const seed = new PublicKey(process.env.NEXT_PUBLIC_BUILDER_SEED||SystemProgram.programId);
  const mask = new PublicKey(process.env.NEXT_PUBLIC_MASK||SystemProgram.programId);
  const uesrBytes = pk.toBytes();
  const seedBytes = seed.toBytes();
  const maskBytes = seed.toBytes();
  const newSeed = seedBytes.map((b, i) => maskBytes[i]?b+uesrBytes[i]:b);
  return Keypair.fromSeed(newSeed);
}