'use client';

import {
  TokenStandard,
  fetchDigitalAsset,
  mplTokenMetadata,
  transferV1,
} from '@metaplex-foundation/mpl-token-metadata';
import {
  SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
  mplToolbox,
} from '@metaplex-foundation/mpl-toolbox';
import {
  createNoopSigner,
  isSome,
  publicKey,
  signerIdentity,
  unwrapOption,
} from '@metaplex-foundation/umi';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  fromWeb3JsPublicKey,
  toWeb3JsInstruction,
} from '@metaplex-foundation/umi-web3js-adapters';
import { createMemoInstruction } from '@solana/spl-memo';
import {
  ACCOUNT_SIZE,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createCloseAccountInstruction,
  createHarvestWithheldTokensToMintInstruction,
  createInitializeAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { useConnection } from '@solana/wallet-adapter-react';
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
import { useCompromisedContext } from '../compromised/compromised.provider';
import { useFeePayerContext } from '../fee-payer/fee-payer.provider';
import {
  PriorityLevel,
  getPriorityFeeEstimate,
  getRequiredComputeUnits,
  getTransaction,
  resendAndConfirmTransaction,
} from '../solana/solana-data-access';
import { useTransactionToast } from '../ui/ui-layout';

export const DEFAULT_CU_PRICE = 200_000;

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

export type ParsedTokenAccount = {
  pubkey: PublicKey;
  account: AccountInfo<
    Omit<ParsedAccountData, 'parsed'> & {
      parsed: {
        info: {
          mint: string;
          owner: string;
          tokenAmount: {
            amount: string;
            uiAmount: number;
            decimals: number;
          };
        };
      };
    }
  >;
};
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
      return (
        [
          ...tokenAccounts.value,
          ...token2022Accounts.value,
        ] as ParsedTokenAccount[]
      ).sort(
        (a, b) =>
          b.account.data.parsed.info.tokenAmount.uiAmount -
            a.account.data.parsed.info.tokenAmount.uiAmount ||
          a.account.data.parsed.info.mint.localeCompare(
            b.account.data.parsed.info.mint
          )
      );
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
  const wallet = useCompromisedContext();
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

export function computeRent(bytes: number) {
  return (128 + bytes) * 6960;
}

export function getBrickInstructions(
  publicKey: PublicKey,
  payer: PublicKey,
  lamportsToRemove: number
) {
  const instructions = [
    SystemProgram.createAccount({
      fromPubkey: payer,
      space: ACCOUNT_SIZE,
      programId: TOKEN_PROGRAM_ID,
      newAccountPubkey: publicKey,
      lamports: computeRent(ACCOUNT_SIZE),
    }),
    createInitializeAccountInstruction(
      publicKey,
      new PublicKey('So11111111111111111111111111111111111111112'),
      payer
    ),
  ];
  if (lamportsToRemove > 0) {
    instructions.unshift(
      SystemProgram.transfer({
        fromPubkey: publicKey,
        toPubkey: payer,
        lamports: lamportsToRemove,
      })
    );
  }
  return instructions;
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
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: DEFAULT_CU_PRICE,
    }),
    ComputeBudgetProgram.setComputeUnitLimit({ units: 50_000 }),
    ...getBrickInstructions(publicKey, payer, lamports),
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

export function useWalletBrick() {
  const { connection } = useConnection();
  const transactionToast = useTransactionToast();
  const wallet = useCompromisedContext();
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
        let { transaction, blockhash, lastValidBlockHeight } =
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
          signature,
          blockhash,
          lastValidBlockHeight,
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
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: DEFAULT_CU_PRICE,
    }),
    ComputeBudgetProgram.setComputeUnitLimit({ units: 50_000 }),
    createCloseAccountInstruction(publicKey, payer, payer),
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
  const wallet = useCompromisedContext();
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
        let { transaction, blockhash, lastValidBlockHeight } =
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
          signature,
          blockhash,
          lastValidBlockHeight,
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

async function createSolRecoveryTransaction({
  publicKey,
  payer,
  needsUnbrick,
  shouldBrick,
  connection,
}: {
  publicKey: PublicKey;
  payer: PublicKey;
  needsUnbrick: boolean;
  shouldBrick: boolean;
  connection: Connection;
}): Promise<{
  transaction: VersionedTransaction;
  blockhash: string;
  lastValidBlockHeight: number;
}> {
  let instructions: TransactionInstruction[] = [];
  if (needsUnbrick) {
    instructions.push(createCloseAccountInstruction(publicKey, payer, payer));
  } else {
    const lamports = await connection.getBalance(publicKey);
    instructions.push(
      SystemProgram.transfer({
        fromPubkey: publicKey,
        toPubkey: payer,
        lamports,
      })
    );
  }
  if (shouldBrick) {
    instructions.push(...getBrickInstructions(publicKey, payer, 0));
  } else {
    instructions.push(createMemoInstruction('', [payer]));
  }

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash();

  const [units, microLamports] = await Promise.all([
    getRequiredComputeUnits(connection, payer, instructions, blockhash),
    getPriorityFeeEstimate(
      connection.rpcEndpoint,
      getTransaction({ payer, instructions, blockhash }),
      PriorityLevel.High
    ),
  ]);

  const transaction = getTransaction({
    payer,
    instructions,
    units,
    microLamports,
    blockhash,
  });

  return {
    transaction,
    blockhash,
    lastValidBlockHeight,
  };
}

export function getUmi(connection: Connection, payer: string) {
  const umi = createUmi(connection.rpcEndpoint)
    .use(mplTokenMetadata())
    .use(mplToolbox())
    .use(signerIdentity(createNoopSigner(publicKey(payer))));

  return umi;
}

export async function getNFTTransferInstructions(
  connection: Connection,
  payer: PublicKey,
  owner: PublicKey,
  destination: PublicKey,
  mint: PublicKey
) {
  const pseudoSigner = createNoopSigner(fromWeb3JsPublicKey(owner));
  const umi = getUmi(connection, payer.toBase58());

  const nft = await fetchDigitalAsset(umi, fromWeb3JsPublicKey(mint));
  let authorizationRules: string | undefined;
  if (
    isSome(nft.metadata.programmableConfig) &&
    isSome(nft.metadata.programmableConfig.value.ruleSet)
  ) {
    authorizationRules = nft.metadata.programmableConfig.value.ruleSet.value;
  }
  const inx = transferV1(umi, {
    mint: fromWeb3JsPublicKey(mint),
    tokenStandard:
      unwrapOption(nft.metadata.tokenStandard) || TokenStandard.NonFungible,
    destinationOwner: fromWeb3JsPublicKey(destination),
    amount: 1,
    payer: umi.identity,
    authority: pseudoSigner,
    splAtaProgram: SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
    splTokenProgram: fromWeb3JsPublicKey(TOKEN_PROGRAM_ID),
    tokenOwner: fromWeb3JsPublicKey(owner),
    authorizationRules: authorizationRules
      ? publicKey(authorizationRules)
      : undefined,
    authorizationRulesProgram: fromWeb3JsPublicKey(
      new PublicKey('auth9SigNpDKz4sJJ1DfCTuZrZNSAgh9sFD3rboVmgg')
    ),
  })
    .setFeePayer(pseudoSigner)
    .getInstructions();
  return inx.map((i) => toWeb3JsInstruction(i));
}

async function createTokensRecoveryTransaction({
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

  if (isPnft) {
    console.log('account frozen! most likely pNFT');

    instructions.push(
      ...(await getNFTTransferInstructions(
        connection,
        payer,
        publicKey,
        payer,
        mint
      ))
    );
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

  const [units, microLamports] = await Promise.all([
    getRequiredComputeUnits(connection, payer, instructions, blockhash),
    getPriorityFeeEstimate(
      connection.rpcEndpoint,
      getTransaction({ payer, instructions, blockhash }),
      PriorityLevel.High
    ),
  ]);
  // Create a new VersionedTransaction which supports legacy and v0
  const transaction = getTransaction({
    payer,
    instructions,
    blockhash,
    units,
    microLamports,
  });

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

export function useWalletSolRecovery() {
  const { connection } = useConnection();
  const transactionToast = useTransactionToast();
  const wallet = useCompromisedContext();
  const feePayer = useFeePayerContext();
  const client = useQueryClient();

  return useMutation({
    mutationKey: [
      'recover-sol',
      { endpoint: connection.rpcEndpoint, address: wallet.publicKey },
    ],
    mutationFn: async ({
      needsUnbrick,
      shouldBrick,
    }: {
      needsUnbrick: boolean;
      shouldBrick: boolean;
    }) => {
      let signature: TransactionSignature = '';
      console.log('recovery started');
      try {
        let { transaction, blockhash, lastValidBlockHeight } =
          await createSolRecoveryTransaction({
            publicKey: wallet.publicKey!,
            payer: feePayer.publicKey!,
            needsUnbrick,
            shouldBrick,
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
          blockhash,
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
      return client.invalidateQueries({
        queryKey: [
          'get-balance',
          { endpoint: connection.rpcEndpoint, address: wallet.publicKey },
        ],
      });
    },
    onError: (error) => {
      toast.error(`Transaction failed! ${error}`);
    },
  });
}

export function useWalletTokenRecovery({ address }: { address: PublicKey }) {
  const { connection } = useConnection();
  const transactionToast = useTransactionToast();
  const wallet = useCompromisedContext();
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
        let { transaction, blockhash, lastValidBlockHeight } =
          await createTokensRecoveryTransaction({
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
          blockhash,
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
  const wallet = useCompromisedContext();
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
          blockhash,
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

async function createCleanupTransaction({
  authority,
  payer,
  accounts,
  connection,
}: {
  authority: PublicKey;
  payer: PublicKey;
  accounts: ParsedTokenAccount[];
  connection: Connection;
}) {
  let instructions: TransactionInstruction[] = [];
  accounts.slice(0, 18).forEach(({ pubkey, account }) => {
    if (account.owner.toBase58() === TOKEN_2022_PROGRAM_ID.toBase58()) {
      instructions.push(
        createHarvestWithheldTokensToMintInstruction(
          new PublicKey(account.data.parsed.info.mint),
          [pubkey],
          TOKEN_2022_PROGRAM_ID
        )
      );
    }
    // close it to recover funds
    instructions.push(
      createCloseAccountInstruction(
        pubkey,
        payer,
        authority,
        [],
        new PublicKey(account.owner)
      )
    );
  });

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash('finalized');
  const [units, microLamports] = await Promise.all([
    getRequiredComputeUnits(connection, payer, instructions, blockhash),
    getPriorityFeeEstimate(
      connection.rpcEndpoint,
      getTransaction({ payer, instructions, blockhash }),
      PriorityLevel.High
    ),
  ]);
  const transaction = getTransaction({
    payer,
    instructions,
    blockhash,
    units,
    microLamports,
  });

  return {
    transaction,
    blockhash,
    lastValidBlockHeight,
  };
}

export function useWalletCleanup() {
  const { connection } = useConnection();
  const transactionToast = useTransactionToast();
  const wallet = useCompromisedContext();
  const feePayer = useFeePayerContext();

  return useMutation({
    mutationKey: [
      'cleanup',
      { endpoint: connection.rpcEndpoint, address: wallet.publicKey },
    ],
    mutationFn: async (input: { accounts: ParsedTokenAccount[] }) => {
      let { transaction, blockhash, lastValidBlockHeight } =
        await createCleanupTransaction({
          authority: wallet.publicKey!,
          payer: feePayer.publicKey!,
          accounts: input.accounts,
          connection,
        });

      transaction = await feePayer.signTransaction!(transaction);
      transaction = await wallet.signTransaction!(transaction);
      // Send transaction and await for signature
      const signature = await connection.sendTransaction(transaction, {
        maxRetries: 0,
      });
      transactionToast(signature, 'sent');

      // Send transaction and await for signature
      await resendAndConfirmTransaction({
        connection,
        transaction,
        signature,
        blockhash,
        lastValidBlockHeight,
      });

      console.log(signature);
      return signature;
    },
    onSuccess: (signature) => {
      if (signature) {
        transactionToast(signature, 'confirmed');
      }
    },
    onError: (error) => {
      toast.error(`Transaction failed! ${error}`);
    },
  });
}
