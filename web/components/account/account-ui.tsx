'use client';

import {
  ACCOUNT_SIZE,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import {
  AccountInfo,
  LAMPORTS_PER_SOL,
  ParsedAccountData,
  PublicKey,
} from '@solana/web3.js';
import { IconRefresh } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { ChangeEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useCluster } from '../cluster/cluster-data-access';
import { ExplorerLink } from '../cluster/cluster-ui';
import { useCompromisedContext } from '../compromised/compromised.provider';
import { useFeePayerContext } from '../fee-payer/fee-payer.provider';
import { AppModal, ellipsify } from '../ui/ui-layout';
import {
  useGetAccount,
  useGetNfts,
  useGetSignatures,
  useGetStakeAccounts,
  useGetTokenAccountBalance,
  useGetTokenAccounts,
  useRequestAirdrop,
  useTransferSol,
  useWalletBrick,
  useWalletTokenRecovery,
  useWalletStakeRecovery,
  useWalletUnbrick,
  useWalletSolRecovery,
  computeRent,
  ParsedTokenAccount,
  useWalletCleanup,
  useWalletTokenFix,
  wSOL,
  useWalletTokenBurn,
} from './account-data-access';
import { PriceInfo, useTokensContext } from '../tokens/tokens-provider';

export function AccountBalance({
  address,
  canRecover,
  isBricked,
}: {
  address: PublicKey;
  canRecover?: boolean;
  isBricked?: boolean;
}) {
  const query = useGetAccount({ address });

  return (
    <div className="flex flex-row justify-center items-center gap-2">
      <h1
        className="text-xl font-bold cursor-pointer"
        onClick={() => query.refetch()}
      >
        {query.data ? <BalanceSol balance={query.data.lamports} /> : '...'} SOL
      </h1>
      {canRecover &&
        (!isBricked ||
          (query.data?.lamports || 0) > computeRent(ACCOUNT_SIZE)) && (
          <ModalRecoverSol isBricked={isBricked} />
        )}
    </div>
  );
}
export function AccountChecker() {
  const { publicKey } = useCompromisedContext();
  if (!publicKey) {
    return null;
  }
  return <AccountBalanceCheck address={publicKey} />;
}
export function AccountBalanceCheck({ address }: { address: PublicKey }) {
  const { cluster } = useCluster();
  const mutation = useRequestAirdrop({ address });
  const query = useGetAccount({ address });

  if (query.isLoading) {
    return null;
  }
  if (query.isError || !query.data?.lamports) {
    return (
      <div className="alert alert-warning text-warning-content/80 rounded-none flex justify-center">
        <span>
          You are connected to <strong>{cluster.name}</strong> but your wallet
          has no funds on this cluster.
        </span>
        {cluster.network !== 'mainnet-beta' && (
          <button
            className="btn btn-xs btn-neutral"
            onClick={() =>
              mutation.mutateAsync(1).catch((err) => console.log(err))
            }
          >
            Request Airdrop
          </button>
        )}
      </div>
    );
  }
  return null;
}

export function AccountButtons({
  address,
  canBrick,
  canUnbrick,
}: {
  address: PublicKey;
  canBrick: boolean;
  canUnbrick: boolean;
}) {
  return (
    <div>
      <div className="flex flex-wrap justify-center gap-2">
        <ModalAirdrop address={address} />
        <ModalReceive address={address} />
        <ModalSend address={address} />
        {canBrick && <ModalBrick />}
        {canUnbrick && <ModalUnbrick />}
      </div>
    </div>
  );
}

export function AccountTokens({ address }: { address: PublicKey }) {
  const compromised = useCompromisedContext();
  const feePayer = useFeePayerContext();
  const { tokens, getPrices } = useTokensContext();
  const [showAll, setShowAll] = useState(false);
  const query = useGetTokenAccounts({ address });
  const client = useQueryClient();
  const cleanupAccounts = useMemo(
    () =>
      query.isFetched &&
      query.data?.filter(
        (a) => a.account.data.parsed.info.tokenAmount.uiAmount === 0
      ),
    [query]
  );
  const fixAccounts = useMemo(
    () =>
      (query.isFetched &&
        compromised.publicKey &&
        query.data?.filter(
          (a) =>
            a.account.data.parsed.info.mint !== wSOL.toBase58() &&
            a.pubkey.toBase58() !==
              getAssociatedTokenAddressSync(
                new PublicKey(a.account.data.parsed.info.mint),
                compromised.publicKey!
              ).toBase58()
        )) ||
      [],
    [query, compromised.publicKey]
  );
  const [tokenPrices, setTokenPrices] = useState<Record<string, PriceInfo>>({});
  useEffect(() => {
    if (query.isFetched && query.data) {
      (async function () {
        const prices = await getPrices(query.data);
        setTokenPrices(prices);
      })();
    }
  }, [getPrices, query.data]);
  const sortedTokens = useMemo(
    () =>
      query.data
        ?.sort((a, b) => {
          const {
            mint: aMint,
            tokenAmount: { uiAmount: aUiAmount },
          } = a.account.data.parsed.info;
          const {
            mint: bMint,
            tokenAmount: { uiAmount: bUiAmount },
          } = b.account.data.parsed.info;
          if (tokenPrices[aMint]) {
            if (tokenPrices[bMint]) {
              return (
                tokenPrices[bMint].price * bUiAmount -
                tokenPrices[aMint].price * aUiAmount
              );
            }
            return -1;
          } else if (tokenPrices[bMint]) {
            return 1;
          }
          return bUiAmount - aUiAmount;
        })
        .slice(0, showAll ? undefined : 5),
    [query.data, tokenPrices, showAll]
  );

  const recoverMutation = useWalletTokenRecovery({ address });
  const handleRecover = useCallback(
    async (accounts: {
      pubkey: PublicKey;
      account: AccountInfo<ParsedAccountData>;
    }) => {
      await recoverMutation.mutateAsync({
        destination: feePayer.publicKey!,
        accounts,
      });
      query.refetch();
    },
    [recoverMutation, query]
  );
  const burnMutation = useWalletTokenBurn({ address });
  const handleBurn = useCallback(
    async (account: ParsedTokenAccount) => {
      await burnMutation.mutateAsync({
        destination: feePayer.publicKey!,
        account,
      });
      query.refetch();
    },
    [burnMutation, query]
  );
  const fixMutation = useWalletTokenFix({ address });
  const handleFix = useCallback(
    async (accounts: {
      pubkey: PublicKey;
      account: AccountInfo<ParsedAccountData>;
    }) => {
      await fixMutation.mutateAsync({
        destination: compromised.publicKey!,
        accounts,
      });
      query.refetch();
    },
    [fixMutation, query]
  );

  return (
    <div className="space-y-2">
      <div className="justify-between">
        <div className="flex justify-between">
          <h2 className="text-2xl font-bold">Token Accounts</h2>
          <div className="flex gap-2 items-center">
            {!!cleanupAccounts && cleanupAccounts.length > 0 && (
              <ModalCleanup accounts={cleanupAccounts} />
            )}
            {query.isLoading ? (
              <span className="loading loading-spinner"></span>
            ) : (
              <button
                className="btn btn-xs btn-outline"
                onClick={async () => {
                  await query.refetch();
                  await client.invalidateQueries({
                    queryKey: ['getTokenAccountBalance'],
                  });
                }}
              >
                <IconRefresh size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
      {query.isError && (
        <pre className="alert alert-warning">
          Error: {query.error?.message.toString()}
        </pre>
      )}
      {query.isSuccess && (
        <div>
          {sortedTokens?.length === 0 ? (
            <div>No token accounts found.</div>
          ) : (
            <div className="overflow-auto">
              <table className="table border rounded-none border-collapse w-full">
                <thead>
                  <tr>
                    <th>Public Key</th>
                    <th>Mint</th>
                    <th className="text-right">Balance</th>
                    <th className="text-right"></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedTokens?.map(({ account, pubkey }) => {
                    const mint = account.data.parsed.info.mint;
                    const token = tokens[mint];
                    return (
                      <tr key={pubkey.toString()}>
                        <td>
                          <div className="flex space-x-2">
                            <span className="font-mono">
                              <ExplorerLink
                                label={ellipsify(pubkey.toString())}
                                path={`account/${pubkey.toString()}`}
                              />
                            </span>
                          </div>
                        </td>
                        <td>
                          <ExplorerLink
                            label={
                              <div className="flex items-center gap-1">
                                {token ? (
                                  <>
                                    <img
                                      src={token.logoURI}
                                      alt={token.symbol}
                                      className="w-5 h-5"
                                    />
                                    <span>{token.symbol}</span>
                                  </>
                                ) : (
                                  ellipsify(account.data.parsed.info.mint)
                                )}
                              </div>
                            }
                            path={`account/${account.data.parsed.info.mint.toString()}`}
                          />
                        </td>
                        <td className="text-right">
                          <div className="font-mono">
                            {account.data.parsed.info.tokenAmount.uiAmount}
                          </div>
                          {tokenPrices[mint] && (
                            <small>
                              ~
                              <Price
                                price={
                                  tokenPrices[mint].price *
                                  account.data.parsed.info.tokenAmount.uiAmount
                                }
                              />
                            </small>
                          )}
                        </td>
                        <td className="text-right flex gap-1 items-center justify-end">
                          {fixAccounts.some(
                            (f) => f.pubkey.toBase58() === pubkey.toBase58()
                          ) && (
                            <button
                              className="btn btn-xs btn-outline"
                              disabled={fixMutation.isPending}
                              onClick={() => handleFix({ pubkey, account })}
                            >
                              Fix
                            </button>
                          )}
                          {account.data.parsed.info.tokenAmount.uiAmount >
                            0 && (
                            <button
                              className="btn btn-xs btn-outline"
                              disabled={burnMutation.isPending}
                              onClick={() =>
                                handleBurn({
                                  pubkey,
                                  account,
                                })
                              }
                            >
                              Burn
                            </button>
                          )}
                          <button
                            className="btn btn-xs btn-outline"
                            disabled={recoverMutation.isPending}
                            onClick={() =>
                              handleRecover({
                                pubkey,
                                account,
                              })
                            }
                          >
                            Recover
                          </button>
                        </td>
                      </tr>
                    );
                  })}

                  {(query.data?.length ?? 0) > 5 && (
                    <tr>
                      <td colSpan={4} className="text-center">
                        <button
                          className="btn btn-xs btn-outline"
                          onClick={() => setShowAll(!showAll)}
                        >
                          {showAll ? 'Show Less' : 'Show All'}
                        </button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function AccountNFTs({ address }: { address: PublicKey }) {
  const [showAll, setShowAll] = useState(false);
  const query = useGetNfts({ address });
  const client = useQueryClient();
  const items = useMemo(() => {
    if (showAll) return query.data!;
    return query.data?.slice(0, 12) || [];
  }, [query.data, showAll]);

  const mutation = useWalletTokenRecovery({ address });
  const feePayer = useFeePayerContext();
  const handleRecover = useCallback(
    async (accounts: {
      pubkey: PublicKey;
      account: AccountInfo<ParsedAccountData>;
    }) => {
      await mutation.mutateAsync({
        destination: feePayer.publicKey!,
        accounts,
      });
      query.refetch();
    },
    [mutation, query]
  );

  return (
    <div className="space-y-2">
      <div className="justify-between">
        <div className="flex justify-between">
          <h2 className="text-2xl font-bold">NFTs</h2>
          <div className="space-x-2">
            {query.isLoading ? (
              <span className="loading loading-spinner"></span>
            ) : (
              <button
                className="btn btn-sm btn-outline"
                onClick={async () => {
                  await query.refetch();
                  await client.invalidateQueries({
                    queryKey: ['get-nfts'],
                  });
                }}
              >
                <IconRefresh size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
      {query.isError && (
        <pre className="alert alert-warning">
          Error: {query.error?.message.toString()}
        </pre>
      )}
      {query.isSuccess && (
        <div>
          {query.data.length === 0 ? (
            <div>No NFTs found.</div>
          ) : (
            <div className="flex flex-wrap gap-2 justify-start">
              {items?.map((n) => (
                <div key={n.id} className="w-40 flex flex-col gap-2 border p-1">
                  <div className="flex space-x-2">
                    <span className="font-mono">
                      <ExplorerLink
                        label={ellipsify(n.id)}
                        path={`account/${n.id}`}
                      />
                    </span>
                  </div>
                  <div className="whitespace-nowrap overflow-hidden text-ellipsis max-w-full">
                    {n.content?.metadata.name || n.content?.metadata.symbol}
                  </div>
                  <img
                    src={
                      n.content?.links?.image || n.content?.links?.animation_url
                    }
                    className="w-40 h-40"
                  />
                  {!!n.ownership.delegate ? (
                    <button className="btn btn-xs btn-outline" disabled>
                      Frozen
                    </button>
                  ) : (
                    <button
                      className="btn btn-xs btn-outline"
                      disabled={mutation.isPending}
                      onClick={() => {
                        handleRecover({
                          pubkey: getAssociatedTokenAddressSync(
                            new PublicKey(n.id),
                            address,
                            true
                          ),
                          account: {
                            data: {
                              program: TOKEN_PROGRAM_ID.toBase58(),
                              space: 0,
                              parsed: {
                                info: {
                                  mint: n.id,
                                  tokenAmount: {
                                    amount: '1',
                                    decimals: 0,
                                  },
                                  state: n.ownership.frozen
                                    ? 'frozen'
                                    : 'unlocked',
                                },
                              },
                            },
                            executable: false,
                            lamports: 0,
                            owner: TOKEN_PROGRAM_ID,
                          },
                        });
                      }}
                    >
                      Recover
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {(query.data?.length ?? 0) > 12 && (
            <div className="text-center mt-4">
              <button
                className="btn btn-xs btn-outline"
                onClick={() => setShowAll(!showAll)}
              >
                {showAll ? 'Show Less' : 'Show All'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function AccountStakeAccounts({ address }: { address: PublicKey }) {
  const [showAll, setShowAll] = useState(false);
  const query = useGetStakeAccounts({ address });
  const client = useQueryClient();
  const items = useMemo(() => {
    if (showAll) return query.data;
    return query.data?.slice(0, 5);
  }, [query.data, showAll]);

  const mutation = useWalletStakeRecovery({ address });
  const handleRecover = useCallback(
    async (accounts: {
      pubkey: PublicKey;
      account: AccountInfo<ParsedAccountData>;
    }) => {
      await mutation.mutateAsync({
        accounts,
      });
      query.refetch();
    },
    [mutation, query]
  );

  return (
    <div className="space-y-2">
      <div className="justify-between">
        <div className="flex justify-between">
          <h2 className="text-2xl font-bold">Stake Accounts</h2>
          <div className="space-x-2">
            {query.isLoading ? (
              <span className="loading loading-spinner"></span>
            ) : (
              <button
                className="btn btn-sm btn-outline"
                onClick={async () => {
                  await query.refetch();
                  await client.invalidateQueries({
                    queryKey: ['getStakeAccounts'],
                  });
                }}
              >
                <IconRefresh size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
      {query.isError && (
        <pre className="alert alert-warning">
          Error: {query.error?.message.toString()}
        </pre>
      )}
      {query.isSuccess && (
        <div>
          {query.data.length === 0 ? (
            <div>No stake accounts found.</div>
          ) : (
            <table className="table border rounded-none border-separate">
              <thead>
                <tr>
                  <th>Public Key</th>
                  <th>Validator</th>
                  <th className="text-right">Stake</th>
                  <th className="text-right"></th>
                </tr>
              </thead>
              <tbody>
                {items?.map(({ account, pubkey }) => (
                  <tr key={pubkey.toString()}>
                    <td>
                      <div className="flex space-x-2">
                        <span className="font-mono">
                          <ExplorerLink
                            label={ellipsify(pubkey.toString())}
                            path={`account/${pubkey.toString()}`}
                          />
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className="flex space-x-2">
                        <span className="font-mono">
                          <ExplorerLink
                            label={ellipsify(
                              account.data.parsed.info.stake.delegation.voter
                            )}
                            path={`account/${account.data.parsed.info.stake.delegation.voter.toString()}`}
                          />
                        </span>
                      </div>
                    </td>
                    <td className="text-right">
                      <span className="font-mono">
                        {+account.data.parsed.info.stake.delegation.stake /
                          LAMPORTS_PER_SOL}
                      </span>
                    </td>
                    <td className="text-right">
                      <button
                        className="btn btn-xs btn-outline"
                        disabled={mutation.isPending}
                        onClick={() => {
                          handleRecover({
                            pubkey: pubkey,
                            account: account,
                          });
                        }}
                      >
                        Recover
                      </button>
                    </td>
                  </tr>
                ))}

                {(query.data?.length ?? 0) > 5 && (
                  <tr>
                    <td colSpan={4} className="text-center">
                      <button
                        className="btn btn-xs btn-outline"
                        onClick={() => setShowAll(!showAll)}
                      >
                        {showAll ? 'Show Less' : 'Show All'}
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

export function AccountTokenBalance({ address }: { address: PublicKey }) {
  const query = useGetTokenAccountBalance({ address });
  return query.isLoading ? (
    <span className="loading loading-spinner"></span>
  ) : query.data ? (
    <div>{query.data?.value.uiAmount}</div>
  ) : (
    <div>Error</div>
  );
}

export function AccountTransactions({ address }: { address: PublicKey }) {
  const query = useGetSignatures({ address });
  const [showAll, setShowAll] = useState(false);

  const items = useMemo(() => {
    if (showAll) return query.data;
    return query.data?.slice(0, 5);
  }, [query.data, showAll]);

  return (
    <div className="space-y-2">
      <div className="flex justify-between">
        <h2 className="text-2xl font-bold">Transaction History</h2>
        <div className="space-x-2">
          {query.isLoading ? (
            <span className="loading loading-spinner"></span>
          ) : (
            <button
              className="btn btn-sm btn-outline"
              onClick={() => query.refetch()}
            >
              <IconRefresh size={16} />
            </button>
          )}
        </div>
      </div>
      {query.isError && (
        <pre className="alert alert-warning">
          Error: {query.error?.message.toString()}
        </pre>
      )}
      {query.isSuccess && (
        <div>
          {query.data.length === 0 ? (
            <div>No transactions found.</div>
          ) : (
            <table className="table border rounded-none border-separate">
              <thead>
                <tr>
                  <th>Signature</th>
                  <th className="text-right">Slot</th>
                  <th>Block Time</th>
                  <th className="text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {items?.map((item) => (
                  <tr key={item.signature}>
                    <th className="font-mono">
                      <ExplorerLink
                        path={`tx/${item.signature}`}
                        label={ellipsify(item.signature, 8)}
                      />
                    </th>
                    <td className="font-mono text-right">
                      <ExplorerLink
                        path={`block/${item.slot}`}
                        label={item.slot.toString()}
                      />
                    </td>
                    <td>
                      {new Date((item.blockTime ?? 0) * 1000).toISOString()}
                    </td>
                    <td className="text-right">
                      {item.err ? (
                        <div
                          className="badge badge-warning"
                          title={JSON.stringify(item.err)}
                        >
                          Failed
                        </div>
                      ) : (
                        <div className="badge badge-success">Success</div>
                      )}
                    </td>
                  </tr>
                ))}
                {(query.data?.length ?? 0) > 5 && (
                  <tr>
                    <td colSpan={4} className="text-center">
                      <button
                        className="btn btn-xs btn-outline"
                        onClick={() => setShowAll(!showAll)}
                      >
                        {showAll ? 'Show Less' : 'Show All'}
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function BalanceSol({ balance }: { balance: number }) {
  return (
    <span>{Math.round((balance / LAMPORTS_PER_SOL) * 100000) / 100000}</span>
  );
}

const formatter = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD',
});
function Price({ price }: { price: number }) {
  return formatter.format(price);
}

function ModalRecoverSol({ isBricked }: { isBricked?: boolean }) {
  const feePayer = useFeePayerContext();
  const mutation = useWalletSolRecovery();
  const [shouldBrick, setShouldBrick] = useState(!!isBricked);
  useEffect(() => {
    setShouldBrick(!!isBricked);
  }, [isBricked]);

  return (
    <AppModal
      title="Recover SOL"
      buttonClassName="btn-xs btn-outline"
      buttonLabel="Recover"
      submitDisabled={mutation.isPending}
      submitLabel="Recover"
      submit={() =>
        mutation
          .mutateAsync({ needsUnbrick: !!isBricked, shouldBrick })
          .then(() => true)
      }
    >
      {isBricked && (
        <div className="alert">
          Wallet is bricked. It'll be unbricked to recover the SOL. We suggest
          to leave it bricked after.
        </div>
      )}
      <fieldset className="flex gap-2">
        <input
          type="checkbox"
          checked={shouldBrick}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            setShouldBrick(e.target.checked)
          }
          id="shouldBrick"
        />
        <label htmlFor="shouldBrick">Brick after recovering</label>
      </fieldset>
      {shouldBrick && (
        <div className="alert alert-warning">
          You will only be able to unbrick it with your safe wallet{' '}
          <b>
            <ExplorerLink
              path={`/account/${feePayer.publicKey?.toBase58()}`}
              label={ellipsify(feePayer.publicKey?.toBase58())}
            />
          </b>
        </div>
      )}
    </AppModal>
  );
}

function ModalReceive({ address }: { address: PublicKey }) {
  return (
    <AppModal title="Receive">
      <p>You can receive assets by sending them to your public key:</p>
      <code>{address.toString()}</code>
    </AppModal>
  );
}

function ModalAirdrop({ address }: { address: PublicKey }) {
  const mutation = useRequestAirdrop({ address });
  const [amount, setAmount] = useState('2');

  return (
    <AppModal
      title="Airdrop"
      submitDisabled={!amount || mutation.isPending}
      submitLabel="Request Airdrop"
      submit={() => mutation.mutateAsync(parseFloat(amount)).then(() => true)}
    >
      <input
        disabled={mutation.isPending}
        type="number"
        step="any"
        min="1"
        placeholder="Amount"
        className="input input-bordered w-full"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
    </AppModal>
  );
}

function ModalSend({ address }: { address: PublicKey }) {
  const wallet = useCompromisedContext();
  const mutation = useTransferSol({ address });
  const [destination, setDestination] = useState('');
  const [amount, setAmount] = useState('1');

  if (!address || !wallet.sendTransaction) {
    return <div>Wallet not connected</div>;
  }

  return (
    <AppModal
      title="Send"
      submitDisabled={!destination || !amount || mutation.isPending}
      submitLabel="Send"
      submit={() =>
        mutation
          .mutateAsync({
            destination: new PublicKey(destination),
            amount: parseFloat(amount),
          })
          .then(() => true)
      }
    >
      <input
        disabled={mutation.isPending}
        type="text"
        placeholder="Destination"
        className="input input-bordered w-full"
        value={destination}
        onChange={(e) => setDestination(e.target.value)}
      />
      <input
        disabled={mutation.isPending}
        type="number"
        step="any"
        min="1"
        placeholder="Amount"
        className="input input-bordered w-full"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
    </AppModal>
  );
}

function ModalBrick() {
  const feePayer = useFeePayerContext();
  const mutation = useWalletBrick();

  return (
    <AppModal
      title="Brick"
      buttonClassName="btn-warning"
      submitDisabled={mutation.isPending}
      submitLabel="Brick"
      submit={() => mutation.mutateAsync().then(() => true)}
    >
      <div className="alert alert-warning">
        Be careful! This will make your wallet unusable, only use if your seed
        or private wallet was leaked and you don't want others might able to use
        it on certain websites.
      </div>
      <div>
        You will only be able to unbrick it with your safe wallet{' '}
        <b>
          <ExplorerLink
            path={`/account/${feePayer.publicKey?.toBase58()}`}
            label={ellipsify(feePayer.publicKey?.toBase58())}
          />
        </b>
      </div>
    </AppModal>
  );
}

function ModalUnbrick() {
  const mutation = useWalletUnbrick();

  return (
    <AppModal
      title="Unbrick"
      buttonClassName="btn-warning"
      submitDisabled={mutation.isPending}
      submitLabel="Unbrick"
      submit={() => mutation.mutateAsync().then(() => true)}
    >
      <div className="alert alert-warning">
        This will make your wallet usable again. If your seed or private wallet
        was leaked, others would be able to use it on certain websites.
      </div>
    </AppModal>
  );
}

function ModalCleanup({ accounts }: { accounts: ParsedTokenAccount[] }) {
  const mutation = useWalletCleanup();

  return (
    <AppModal
      title="Cleanup"
      buttonClassName="btn-xs btn-neutral"
      buttonLabel="Cleanup"
      submitDisabled={mutation.isPending}
      submitLabel="Cleanup"
      submit={() => mutation.mutateAsync({ accounts }).then(() => true)}
    >
      <div>
        Closing <b>{accounts.length}</b> token accounts for{' '}
        {(accounts.length * computeRent(ACCOUNT_SIZE)) / LAMPORTS_PER_SOL} SOL
      </div>
    </AppModal>
  );
}
