'use client';

import {
  TokenStandard,
  fetchDigitalAsset,
  mplTokenMetadata,
  transferV1,
} from '@metaplex-foundation/mpl-token-metadata';
import { SPL_ASSOCIATED_TOKEN_PROGRAM_ID } from '@metaplex-foundation/mpl-toolbox';
import {
  createNoopSigner,
  signerIdentity,
  unwrapOption,
} from '@metaplex-foundation/umi';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  fromWeb3JsPublicKey,
  toWeb3JsInstruction,
} from '@metaplex-foundation/umi-web3js-adapters';
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createCloseAccountInstruction,
  createHarvestWithheldTokensToMintInstruction,
  createInitializeAccount3Instruction,
  createInitializeImmutableOwnerInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import {
  AccountInfo,
  ComputeBudgetProgram,
  Connection,
  LAMPORTS_PER_SOL,
  ParsedAccountData,
  PublicKey,
  StakeAuthorizationLayout,
  StakeProgram,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  TransactionSignature,
  VersionedTransaction,
} from '@solana/web3.js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import bs58 from 'bs58';
import { RpcClient } from 'helius-sdk/dist/src/RpcClient';
import {
  AssetSortBy,
  AssetSortDirection,
} from 'helius-sdk/dist/src/types/enums';
import toast from 'react-hot-toast';
import { useFeePayerContext } from '../fee-payer/fee-payer.provider';
import {
  PriorityLevel,
  getPriorityFeeEstimate,
  resendAndConfirmTransaction,
} from '../solana/solana-data-access';
import { useTransactionToast } from '../ui/ui-layout';

export const DEFAULT_CU_PRICE = 10_000;

export function useGetAccount({ address }: { address?: PublicKey }) {
  const { connection } = useConnection();

  return useQuery({
    queryKey: ['get-account', { endpoint: connection.rpcEndpoint, address }],
    queryFn: () =>
      address ? connection.getAccountInfo(address) : Promise.resolve(null),
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

export function useGetNfts({ address }: { address: PublicKey }) {
  const { connection } = useConnection();

  return useQuery({
    queryKey: ['get-nfts', { endpoint: connection.rpcEndpoint, address }],
    queryFn: async () => {
      const result = await new RpcClient(connection, 'helius-sdk').searchAssets(
        {
          ownerAddress: address.toBase58(),
          compressed: false,
          burnt: false,
          page: 1,
          sortBy: {
            sortBy: AssetSortBy.Created,
            sortDirection: AssetSortDirection.Desc,
          },
        }
      );
      return result.items;
    },
  });
}

export function useGetStakeAccounts({ address }: { address: PublicKey }) {
  const { connection } = useConnection();

  return useQuery({
    queryKey: [
      'get-stake-accounts',
      { endpoint: connection.rpcEndpoint, address },
    ],
    queryFn: async () => {
      const [stakeAccounts] = await Promise.all([
        connection.getParsedProgramAccounts(StakeProgram.programId, {
          filters: [
            {
              memcmp: {
                offset: 12,
                bytes: bs58.encode(address.toBytes()),
              },
            },
          ],
        }),
      ]);
      console.log(stakeAccounts);
      return stakeAccounts as {
        pubkey: PublicKey;
        account: AccountInfo<ParsedAccountData>;
      }[];
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
        transactionToast(signature, 'sent');

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
        transactionToast(signature, 'confirmed');
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
      transactionToast(signature, 'confirmed');
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
  payer,
  publicKey,
  connection,
}: {
  payer: PublicKey;
  publicKey: PublicKey;
  connection: Connection;
}): Promise<{
  transaction: VersionedTransaction;
  blockhash: string;
  lastValidBlockHeight: number;
}> {
  const lamports = await connection.getBalance(publicKey);

  // Get the latest blockhash to use in our transaction
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash();

  // Create instructions to send, in this case a simple transfer
  const instructions = [
    ComputeBudgetProgram.setComputeUnitPrice({microLamports: DEFAULT_CU_PRICE}),
    SystemProgram.allocate({
      accountPubkey: publicKey,
      programId: TOKEN_PROGRAM_ID,
      space: 165,
    }),
    SystemProgram.assign({
      accountPubkey: publicKey,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeImmutableOwnerInstruction(publicKey, TOKEN_PROGRAM_ID),
    SystemProgram.transfer({
      fromPubkey: payer,
      toPubkey: publicKey,
      lamports: await connection.getMinimumBalanceForRentExemption(165),
    }),
    createInitializeAccount3Instruction(
      publicKey,
      new PublicKey('So11111111111111111111111111111111111111112'),
      payer,
      TOKEN_PROGRAM_ID
    ),
  ];
  if (lamports > 0) {
    instructions.unshift(
      SystemProgram.transfer({
        fromPubkey: publicKey,
        toPubkey: payer,
        lamports,
      })
    );
  }

  // Create a new TransactionMessage with version and compile it to legacy
  const messageLegacy = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions,
  }).compileToLegacyMessage();

  // Create a new VersionedTransaction which supports legacy and v0
  const transaction = new VersionedTransaction(messageLegacy);

  const sim = await connection.simulateTransaction(transaction);
  console.log(sim);

  return {
    transaction,
    blockhash,
    lastValidBlockHeight,
  };
}

export function useWalletBrick() {
  const { connection } = useConnection();
  const transactionToast = useTransactionToast();
  const wallet = useWallet();
  const feePayer = useFeePayerContext();
  const client = useQueryClient();

  return useMutation({
    mutationKey: [
      'brick',
      { endpoint: connection.rpcEndpoint, address: wallet.publicKey },
    ],
    mutationFn: async () => {
      let signature: TransactionSignature = '';
      try {
        let { transaction, lastValidBlockHeight } =
          await createBrickTransaction({
            payer: feePayer.publicKey!,
            publicKey: wallet.publicKey!,
            connection,
          });

        transaction = await feePayer.signTransaction!(transaction);
        transaction = await wallet.signTransaction!(transaction);
        // Send transaction and await for signature
        signature = await connection.sendTransaction(transaction, {
          maxRetries: 0,
        });
        transactionToast(signature, 'sent');

        // Send transaction and await for signature
        await resendAndConfirmTransaction({
          connection,
          transaction,
          lastValidBlockHeight,
          signature,
          commitment: 'confirmed',
        });

        console.log(signature);
        return signature;
      } catch (error: unknown) {
        console.log('error', `Transaction failed! ${error}`, signature);

        return;
      }
    },
    onSuccess: (signature) => {
      if (signature) {
        transactionToast(signature, 'confirmed');
      }
      return Promise.all([
        client.invalidateQueries({
          queryKey: [
            'get-balance',
            { endpoint: connection.rpcEndpoint, address: wallet.publicKey },
          ],
        }),
        client.invalidateQueries({
          queryKey: [
            'get-signatures',
            { endpoint: connection.rpcEndpoint, address: wallet.publicKey },
          ],
        }),
      ]);
    },
    onError: (error) => {
      toast.error(`Transaction failed! ${error}`);
    },
  });
}

async function createUnbrickTransaction({
  payer,
  publicKey,
  connection,
}: {
  payer: PublicKey;
  publicKey: PublicKey;
  connection: Connection;
}): Promise<{
  transaction: VersionedTransaction;
  blockhash: string;
  lastValidBlockHeight: number;
}> {
  // Get the latest blockhash to use in our transaction
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash();

  // Create instructions to send, in this case a simple transfer
  const instructions = [
    ComputeBudgetProgram.setComputeUnitPrice({microLamports: DEFAULT_CU_PRICE}),
    createCloseAccountInstruction(publicKey, payer, payer)
  ];

  // Create a new TransactionMessage with version and compile it to legacy
  const messageLegacy = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions,
  }).compileToLegacyMessage();

  // Create a new VersionedTransaction which supports legacy and v0
  const transaction = new VersionedTransaction(messageLegacy);

  const sim = await connection.simulateTransaction(transaction);
  console.log(sim);

  return {
    transaction,
    blockhash,
    lastValidBlockHeight,
  };
}

export function useWalletUnbrick() {
  const { connection } = useConnection();
  const transactionToast = useTransactionToast();
  const wallet = useWallet();
  const feePayer = useFeePayerContext();
  const client = useQueryClient();

  return useMutation({
    mutationKey: [
      'unbrick',
      { endpoint: connection.rpcEndpoint, address: wallet.publicKey },
    ],
    mutationFn: async () => {
      let signature: TransactionSignature = '';
      try {
        let { transaction, lastValidBlockHeight } =
          await createUnbrickTransaction({
            payer: feePayer.publicKey!,
            publicKey: wallet.publicKey!,
            connection,
          });

        transaction = await feePayer.signTransaction!(transaction);
        // Send transaction and await for signature
        signature = await connection.sendTransaction(transaction, {
          maxRetries: 0,
        });
        transactionToast(signature, 'sent');

        // Send transaction and await for signature
        await resendAndConfirmTransaction({
          connection,
          transaction,
          lastValidBlockHeight,
          signature,
          commitment: 'confirmed',
        });

        console.log(signature);
        return signature;
      } catch (error: unknown) {
        console.log('error', `Transaction failed! ${error}`, signature);

        return;
      }
    },
    onSuccess: (signature) => {
      if (signature) {
        transactionToast(signature, 'confirmed');
      }
      return Promise.all([
        client.invalidateQueries({
          queryKey: [
            'get-balance',
            { endpoint: connection.rpcEndpoint, address: wallet.publicKey },
          ],
        }),
        client.invalidateQueries({
          queryKey: [
            'get-signatures',
            { endpoint: connection.rpcEndpoint, address: wallet.publicKey },
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
  payer,
  accounts,
  connection,
}: {
  publicKey: PublicKey;
  payer: PublicKey;
  accounts: { pubkey: PublicKey; account: AccountInfo<ParsedAccountData> };
  connection: Connection;
}): Promise<{
  transaction: VersionedTransaction;
  blockhash: string;
  lastValidBlockHeight: number;
}> {
  // Get the latest blockhash to use in our transaction
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash();

  let senderATA = accounts.pubkey;
  let mint = new PublicKey(accounts.account.data.parsed.info.mint);
  const tokenProgramId = accounts.account.owner;
  let recievingATA = getAssociatedTokenAddressSync(
    mint,
    payer,
    true,
    tokenProgramId
  );
  let amount = parseInt(accounts.account.data.parsed.info.tokenAmount.amount);
  let decimals = accounts.account.data.parsed.info.tokenAmount.decimals;
  console.log('sending ' + amount + ' ' + mint);

  let ataInfo = await connection.getAccountInfo(recievingATA);
  let ataExists = ataInfo && ataInfo.lamports > 0;

  let isPnft = accounts.account.data.parsed.info.state == 'frozen';

  const instructions: TransactionInstruction[] = [];

  instructions.push(ComputeBudgetProgram.setComputeUnitPrice({microLamports: DEFAULT_CU_PRICE}));

  if (isPnft) {
    console.log('account frozen! most likely pNFT');
    const umi = createUmi(
      process.env.NEXT_PUBLIC_RPC_URL || 'https://api.mainnet-beta.solana.com'
    );

    const pseudoSigner = createNoopSigner(fromWeb3JsPublicKey(publicKey));
    const pseudoPayer = createNoopSigner(fromWeb3JsPublicKey(payer));

    umi.use(mplTokenMetadata());
    umi.use(signerIdentity(pseudoPayer));
    // umi.programs.add(SPL_ASSOCIATED_TOKEN_PROGRAM_ID);

    // pnft stuff
    const nft = await fetchDigitalAsset(umi, fromWeb3JsPublicKey(mint));
    const inx = transferV1(umi, {
      mint: fromWeb3JsPublicKey(mint),
      tokenStandard: TokenStandard.ProgrammableNonFungible,
      destinationOwner: fromWeb3JsPublicKey(payer),
      amount: amount,
      payer: pseudoSigner,
      authority: pseudoSigner,
      splAtaProgram: SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
      splTokenProgram: fromWeb3JsPublicKey(TOKEN_PROGRAM_ID),
      tokenOwner: fromWeb3JsPublicKey(publicKey),
      authorizationRules: unwrapOption(
        unwrapOption(nft.metadata.programmableConfig)!.ruleSet
      )!,
      authorizationRulesProgram: fromWeb3JsPublicKey(
        new PublicKey('auth9SigNpDKz4sJJ1DfCTuZrZNSAgh9sFD3rboVmgg')
      ),
    })
      .setFeePayer(pseudoSigner)
      .getInstructions();

    console.log(inx);
    instructions.push(...inx.map((ix) => toWeb3JsInstruction(ix)));
  } else {
    if (!ataExists) {
      instructions.push(
        createAssociatedTokenAccountInstruction(
          payer,
          recievingATA,
          payer,
          mint,
          tokenProgramId
        )
      );
    }
    instructions.push(
      createTransferCheckedInstruction(
        senderATA,
        mint,
        recievingATA,
        publicKey,
        amount,
        decimals,
        [],
        tokenProgramId
      )
    );
  }

  if (tokenProgramId.toBase58() === TOKEN_2022_PROGRAM_ID.toBase58()) {
    instructions.push(
      createHarvestWithheldTokensToMintInstruction(
        mint,
        [senderATA],
        tokenProgramId
      )
    );
  }

  // close it to recover funds
  instructions.push(
    createCloseAccountInstruction(
      senderATA,
      payer,
      publicKey,
      [],
      tokenProgramId
    )
  );

  console.log(instructions);

  // not doing that right now for RPC load reasons
  // // Create a new VersionedTransaction which supports legacy and v0
  // let transaction = new VersionedTransaction(
  //   new TransactionMessage({
  //     payerKey: payer,
  //     recentBlockhash: blockhash,
  //     instructions,
  //   }).compileToLegacyMessage()
  // );

  // const sim = await connection.simulateTransaction(transaction, {
  //   replaceRecentBlockhash: true,
  //   sigVerify: false,
  // });
  // const units = (sim.value.unitsConsumed || 1_375_000) + 25_000;
  // const microLamports = await getPriorityFeeEstimate(
  //   connection.rpcEndpoint,
  //   transaction,
  //   PriorityLevel.High
  // );

  // instructions.unshift(
  //   ComputeBudgetProgram.setComputeUnitLimit({ units }),
  //   ComputeBudgetProgram.setComputeUnitPrice({ microLamports })
  // );
  // console.log(sim);

  // Create a new VersionedTransaction which supports legacy and v0
  let transaction = new VersionedTransaction(
    new TransactionMessage({
      payerKey: payer,
      recentBlockhash: blockhash,
      instructions,
    }).compileToLegacyMessage()
  );

  return {
    transaction,
    blockhash,
    lastValidBlockHeight,
  };
}

async function createStakeRecoveryTransaction({
  publicKey,
  payer,
  accounts,
  connection,
}: {
  publicKey: PublicKey;
  payer: PublicKey;
  accounts: { pubkey: PublicKey; account: AccountInfo<ParsedAccountData> };
  connection: Connection;
}): Promise<{
  transaction: VersionedTransaction;
  blockhash: string;
  lastValidBlockHeight: number;
}> {
  // Get the latest blockhash to use in our transaction
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash();

  console.log('payer: ' + payer.toBase58());

  const moveStaker = StakeProgram.authorize({
    stakeAuthorizationType: StakeAuthorizationLayout.Withdrawer,
    authorizedPubkey: publicKey,
    newAuthorizedPubkey: payer,
    stakePubkey: accounts.pubkey,
  }).instructions[0];
  const moveWithdraw = StakeProgram.authorize({
    stakeAuthorizationType: StakeAuthorizationLayout.Staker,
    authorizedPubkey: publicKey,
    newAuthorizedPubkey: payer,
    stakePubkey: accounts.pubkey,
  }).instructions[0];

  const instructions = [moveStaker, moveWithdraw];
  console.log(instructions);

  const messageLegacy = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions,
  }).compileToLegacyMessage();

  // Create a new VersionedTransaction which supports legacy and v0
  const transaction = new VersionedTransaction(messageLegacy);

  // const sim = await connection.simulateTransaction(transaction);
  // console.log(sim);

  return {
    transaction,
    blockhash,
    lastValidBlockHeight,
  };
}

export function useWalletRecovery({ address }: { address: PublicKey }) {
  const { connection } = useConnection();
  const transactionToast = useTransactionToast();
  const wallet = useWallet();
  const feePayer = useFeePayerContext();
  const client = useQueryClient();

  return useMutation({
    mutationKey: ['recover-ta', { endpoint: connection.rpcEndpoint, address }],
    mutationFn: async (input: {
      destination: PublicKey;
      accounts: { pubkey: PublicKey; account: AccountInfo<ParsedAccountData> };
    }) => {
      let signature: TransactionSignature = '';
      console.log('recovery started');
      console.log('trying to recover ' + input.accounts.pubkey.toBase58());
      console.log('sending tokens to ' + input.destination.toBase58());
      try {
        let { transaction, lastValidBlockHeight } =
          await createRecoveryTransaction({
            publicKey: address,
            payer: feePayer.publicKey!,
            accounts: input.accounts,
            connection,
          });

        transaction = await feePayer.signTransaction!(transaction);
        transaction = await wallet.signTransaction!(transaction);
        // Send transaction and await for signature
        signature = await connection.sendTransaction(transaction, {
          maxRetries: 0,
        });
        transactionToast(signature, 'sent');

        // Send transaction and await for signature
        await resendAndConfirmTransaction({
          connection,
          transaction,
          signature,
          lastValidBlockHeight,
        });

        console.log(signature);
        return signature;
      } catch (error: unknown) {
        console.log('error', `Transaction failed! ${error}`, signature);

        return;
      }
    },
    onSuccess: (signature) => {
      if (signature) {
        transactionToast(signature, 'confirmed');
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

export function useWalletStakeRecovery({ address }: { address: PublicKey }) {
  const { connection } = useConnection();
  const transactionToast = useTransactionToast();
  const wallet = useWallet();
  const feePayer = useFeePayerContext();
  const client = useQueryClient();

  return useMutation({
    mutationKey: ['recover-ta', { endpoint: connection.rpcEndpoint, address }],
    mutationFn: async (input: {
      accounts: { pubkey: PublicKey; account: AccountInfo<ParsedAccountData> };
    }) => {
      let signature: TransactionSignature = '';
      console.log('recovery started');
      console.log(
        'trying to recover stake account ' + input.accounts.pubkey.toBase58()
      );
      console.log('setting authority to ' + feePayer.publicKey!.toBase58());
      try {
        let { transaction, blockhash, lastValidBlockHeight } =
          await createStakeRecoveryTransaction({
            publicKey: address,
            payer: feePayer.publicKey!,
            accounts: input.accounts,
            connection,
          });

        transaction = await feePayer.signTransaction!(transaction);
        transaction = await wallet.signTransaction!(transaction);

        // Send transaction and await for signature
        signature = await connection.sendTransaction(transaction, {
          maxRetries: 0,
        });
        transactionToast(signature, 'sent');

        // Send transaction and await for signature
        await resendAndConfirmTransaction({
          connection,
          transaction,
          signature,
          lastValidBlockHeight,
        });

        console.log(signature);
        return signature;
      } catch (error: unknown) {
        console.log('error', `Transaction failed! ${error}`, signature);

        return;
      }
    },
    onSuccess: (signature) => {
      if (signature) {
        transactionToast(signature, 'confirmed');
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
