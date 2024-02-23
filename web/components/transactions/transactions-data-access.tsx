'use client';

import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import bs58 from "bs58";


export function buildTransactionFromPayload(payload: string, feepayer: Keypair, publicKey: PublicKey){
  
  const decodedMessage = bs58.decode(payload);
  const emptySignature = new Uint8Array(1+64);
  emptySignature[0] = 1;

  const serialTx = new Uint8Array(emptySignature.length+decodedMessage.length)
  serialTx.set(emptySignature, 0),
  serialTx.set(decodedMessage, emptySignature.length)

  const tx = Transaction.from(serialTx);
  tx.feePayer = feepayer.publicKey;
  return tx;
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