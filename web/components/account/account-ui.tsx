'use client';

import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  AccountInfo,
  LAMPORTS_PER_SOL,
  ParsedAccountData,
  PublicKey,
} from '@solana/web3.js';
import { IconRefresh } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { useCluster } from '../cluster/cluster-data-access';
import { ExplorerLink } from '../cluster/cluster-ui';
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
  useWalletRecovery,
  useWalletStakeRecovery,
  useWalletUnbrick,
} from './account-data-access';

export function AccountBalance({ address }: { address: PublicKey }) {
  const query = useGetAccount({ address });

  return (
    <div>
      <h1
        className="text-xl font-bold cursor-pointer"
        onClick={() => query.refetch()}
      >
        {query.data ? <BalanceSol balance={query.data.lamports} /> : '...'} SOL
      </h1>
    </div>
  );
}
export function AccountChecker() {
  const { publicKey } = useWallet();
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
          You are connected to <strong>{cluster.name}</strong> but your account
          is not found on this cluster.
        </span>
        <button
          className="btn btn-xs btn-neutral"
          onClick={() =>
            mutation.mutateAsync(1).catch((err) => console.log(err))
          }
        >
          Request Airdrop
        </button>
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
  const wallet = useWallet();
  const { cluster } = useCluster();
  const [showAirdropModal, setShowAirdropModal] = useState(false);
  const [showReceiveModal, setShowReceiveModal] = useState(false);
  const [showSendModal, setShowSendModal] = useState(false);
  const [showBrickModal, setShowBrickModal] = useState(false);
  const [showUnbrickModal, setShowUnbrickModal] = useState(false);

  return (
    <div>
      <ModalAirdrop
        hide={() => setShowAirdropModal(false)}
        address={address}
        show={showAirdropModal}
      />
      <ModalReceive
        address={address}
        show={showReceiveModal}
        hide={() => setShowReceiveModal(false)}
      />
      <ModalSend
        address={address}
        show={showSendModal}
        hide={() => setShowSendModal(false)}
      />
      <ModalBrick show={showBrickModal} hide={() => setShowBrickModal(false)} />
      <ModalUnbrick
        show={showUnbrickModal}
        hide={() => setShowUnbrickModal(false)}
      />
      <div className="space-x-2">
        <button
          disabled={cluster.network?.includes('mainnet')}
          className="btn btn-xs lg:btn-md btn-outline"
          onClick={() => setShowAirdropModal(true)}
        >
          Airdrop
        </button>
        <button
          disabled={wallet.publicKey?.toString() !== address.toString()}
          className="btn btn-xs lg:btn-md btn-outline"
          onClick={() => setShowSendModal(true)}
        >
          Send
        </button>
        <button
          className="btn btn-xs lg:btn-md btn-outline"
          onClick={() => setShowReceiveModal(true)}
        >
          Receive
        </button>
        {canBrick && (
          <button
            className="btn btn-xs lg:btn-md btn-outline"
            onClick={() => setShowBrickModal(true)}
          >
            Brick
          </button>
        )}
        {canUnbrick && (
          <button
            className="btn btn-xs lg:btn-md btn-outline"
            onClick={() => setShowUnbrickModal(true)}
          >
            Unbrick
          </button>
        )}
      </div>
    </div>
  );
}

export function AccountTokens({ address }: { address: PublicKey }) {
  const [showAll, setShowAll] = useState(false);
  const query = useGetTokenAccounts({ address });
  const client = useQueryClient();
  const items = useMemo(() => {
    if (showAll) return query.data;
    return query.data?.slice(0, 5);
  }, [query.data, showAll]);

  const mutation = useWalletRecovery({ address });
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
          <h2 className="text-2xl font-bold">Token Accounts</h2>
          <div className="space-x-2">
            {query.isLoading ? (
              <span className="loading loading-spinner"></span>
            ) : (
              <button
                className="btn btn-sm btn-outline"
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
        <pre className="alert alert-error">
          Error: {query.error?.message.toString()}
        </pre>
      )}
      {query.isSuccess && (
        <div>
          {query.data.length === 0 ? (
            <div>No token accounts found.</div>
          ) : (
            <table className="table border-4 rounded-lg border-separate border-base-300">
              <thead>
                <tr>
                  <th>Public Key</th>
                  <th>Mint</th>
                  <th className="text-right">Balance</th>
                  <th className="text-right">Recovery</th>
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
                            label={ellipsify(account.data.parsed.info.mint)}
                            path={`account/${account.data.parsed.info.mint.toString()}`}
                          />
                        </span>
                      </div>
                    </td>
                    <td className="text-right">
                      <span className="font-mono">
                        {account.data.parsed.info.tokenAmount.uiAmount}
                        {/* <AccountTokenBalance address={pubkey} /> */}
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

export function AccountNFTs({ address }: { address: PublicKey }) {
  const [showAll, setShowAll] = useState(false);
  const query = useGetNfts({ address });
  const client = useQueryClient();
  const items = useMemo(() => {
    if (showAll) return query.data!;
    return query.data?.slice(0, 12) || [];
  }, [query.data, showAll]);

  const mutation = useWalletRecovery({ address });
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
        <pre className="alert alert-error">
          Error: {query.error?.message.toString()}
        </pre>
      )}
      {query.isSuccess && (
        <div>
          {query.data.length === 0 ? (
            <div>No NFTs found.</div>
          ) : (
            <div className="flex flex-wrap gap-4 justify-center">
              {items?.map((n) => (
                <div key={n.id} className="w-40 flex flex-col gap-2">
                  <div className="flex space-x-2">
                    <span className="font-mono">
                      <ExplorerLink
                        label={ellipsify(n.id)}
                        path={`account/${n.id}`}
                      />
                    </span>
                  </div>
                  <div>
                    {n.content?.metadata.name || n.content?.metadata.symbol}
                  </div>
                  <img
                    src={
                      n.content?.links?.image || n.content?.links?.animation_url
                    }
                    className="w-40 h-40"
                  />
                  {!!n.ownership.delegate ? (
                    <i>Frozen</i>
                  ) : (
                    <button
                      className="btn btn-xs btn-outline"
                      disabled={mutation.isPending}
                      onClick={() => {
                        handleRecover({
                          pubkey: new PublicKey(
                            (n as any).token_info.associated_token_address
                          ),
                          account: {
                            data: {
                              program: (n as any).token_info.token_program,
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

              {(query.data?.length ?? 0) > 12 && (
                <div className="text-center">
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
        <pre className="alert alert-error">
          Error: {query.error?.message.toString()}
        </pre>
      )}
      {query.isSuccess && (
        <div>
          {query.data.length === 0 ? (
            <div>No stake accounts found.</div>
          ) : (
            <table className="table border-4 rounded-lg border-separate border-base-300">
              <thead>
                <tr>
                  <th>Public Key</th>
                  <th>Validator</th>
                  <th className="text-right">Stake</th>
                  <th className="text-right">Recovery</th>
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
        <pre className="alert alert-error">
          Error: {query.error?.message.toString()}
        </pre>
      )}
      {query.isSuccess && (
        <div>
          {query.data.length === 0 ? (
            <div>No transactions found.</div>
          ) : (
            <table className="table border-4 rounded-lg border-separate border-base-300">
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
                          className="badge badge-error"
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

function ModalReceive({
  hide,
  show,
  address,
}: {
  hide: () => void;
  show: boolean;
  address: PublicKey;
}) {
  return (
    <AppModal title="Receive" hide={hide} show={show}>
      <p>You can receive assets by sending them to your public key:</p>
      <code>{address.toString()}</code>
    </AppModal>
  );
}

function ModalAirdrop({
  hide,
  show,
  address,
}: {
  hide: () => void;
  show: boolean;
  address: PublicKey;
}) {
  const mutation = useRequestAirdrop({ address });
  const [amount, setAmount] = useState('2');

  return (
    <AppModal
      hide={hide}
      show={show}
      title="Airdrop"
      submitDisabled={!amount || mutation.isPending}
      submitLabel="Request Airdrop"
      submit={() => mutation.mutateAsync(parseFloat(amount)).then(() => hide())}
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

function ModalSend({
  hide,
  show,
  address,
}: {
  hide: () => void;
  show: boolean;
  address: PublicKey;
}) {
  const wallet = useWallet();
  const mutation = useTransferSol({ address });
  const [destination, setDestination] = useState('');
  const [amount, setAmount] = useState('1');

  if (!address || !wallet.sendTransaction) {
    return <div>Wallet not connected</div>;
  }

  return (
    <AppModal
      hide={hide}
      show={show}
      title="Send"
      submitDisabled={!destination || !amount || mutation.isPending}
      submitLabel="Send"
      submit={() => {
        mutation
          .mutateAsync({
            destination: new PublicKey(destination),
            amount: parseFloat(amount),
          })
          .then(() => hide());
      }}
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

function ModalBrick({ hide, show }: { hide: () => void; show: boolean }) {
  const feePayer = useFeePayerContext();
  const mutation = useWalletBrick();

  return (
    <AppModal
      hide={hide}
      show={show}
      title="Brick"
      submitDisabled={mutation.isPending}
      submitLabel="Brick"
      submit={() => {
        mutation.mutateAsync().then(() => hide());
      }}
    >
      <div className="text-red-600">
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

function ModalUnbrick({ hide, show }: { hide: () => void; show: boolean }) {
  const mutation = useWalletUnbrick();

  return (
    <AppModal
      hide={hide}
      show={show}
      title="Unbrick"
      submitDisabled={mutation.isPending}
      submitLabel="Unbrick"
      submit={() => {
        mutation.mutateAsync().then(() => hide());
      }}
    >
      <div className="text-red-600">
        This will make your wallet usable again. If your seed or private wallet
        was leaked, others would be able to use it on certain websites.
      </div>
    </AppModal>
  );
}
