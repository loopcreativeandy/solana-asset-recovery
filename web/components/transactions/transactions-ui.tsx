'use client';

import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { IconTrash } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { ReactNode, useEffect, useState } from 'react';
import { AppModal, useTransactionToast } from '../ui/ui-layout';
import { useCluster } from '../cluster/cluster-data-access';
import { Keypair, PublicKey, SystemProgram, Transaction, VersionedTransaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { buildTransactionFromPayload, getFeepayerForWallet } from './transactions-data-access';
import { AccountBalance } from '../account/account-ui';
import { text } from 'stream/consumers';


export function TransactionUi() {
  const wallet = useWallet();
  const { cluster } = useCluster();
  const { connection } = useConnection();
  
  const transactionToast = useTransactionToast();
  
  const [feepayer, setFeePayer] = useState<Keypair|undefined>();
  const [signature, setSignature] = useState("");
  const [payload, setPayload] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if(!wallet.publicKey) return;
    const fp = getFeepayerForWallet(wallet.publicKey);
    setFeePayer(fp);
  
  }, [wallet]);
  function startSendTransaction() {
    sendTransaction();
  }
  async function sendTransaction() {
    if(!wallet.publicKey) return;
    if(!feepayer) return;
    if(!payload || payload.length==0) {
      setError("Error: Payload not defined")
      setSignature("");
      return;
    }
    
    try{
      const tx = await buildTransactionFromPayload(connection, payload, feepayer, wallet.publicKey);
      //setTransaction(tx);
      const signature = await wallet.sendTransaction(tx, connection);
      setSignature(signature);
      setError('')
      transactionToast(signature);
    } catch (e: any) {
      setError(e.toString())
    }
  
  }

  const handlePayloadChange =  function(event: any) {
    setPayload(event.target.value);
  }
  
  return (
    <div>
    <div className="space-y-2">{!wallet.publicKey || !feepayer ?<h2 className="text-2xl font-bold">Please connect your wallet!</h2> : 
      <div>
        <div className="">
        <h2 className="text-2xl font-bold">Step 1: fund this keypair</h2>
        </div>
        <div className="flex justify-between">
        <div className="space-x-2"></div>
        <div>Send some SOL to {feepayer.publicKey.toBase58()} </div>

        <div className="">
          current balance: <AccountBalance address={feepayer.publicKey}></AccountBalance>
        </div>
        </div>
        <h2 className="text-2xl font-bold">Step 2: build transaction</h2>
        <div className="space-x-2"></div>
        <div>Go to protocol website as usual, use Solflare wallet, and instead of signing paste payload here: </div>
        <div className="space-x-2"></div>
        <textarea name="payload" rows={4} cols={80} onChange={handlePayloadChange}/>
        
        <div className="space-x-2"></div><button
          className="btn btn-xs lg:btn-md btn-primary"
          disabled={!payload}
          onClick={() => startSendTransaction()}
        >
          Send Transaction
        </button>
        <div className="space-x-2"></div><div>{error}{signature?"Signature: "+signature:""}</div>
        </div>
}
        </div>
        </div>
  );
}
