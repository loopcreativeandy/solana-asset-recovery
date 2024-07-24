'use client';

import { base58 } from '@metaplex-foundation/umi/serializers';
import { useConnection } from '@solana/wallet-adapter-react';
import {
  AccountMeta,
  Keypair,
  PublicKey,
  TransactionInstruction,
} from '@solana/web3.js';
import React, {
  ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { ExplorerLink } from '../cluster/cluster-ui';
import { useCompromisedContext } from '../compromised/compromised.provider';
import { useFeePayerContext } from '../fee-payer/fee-payer.provider';
import { FeePayerWalletButton } from '../fee-payer/fee-payer.ui';
import {
  DecodedTransaction,
  buildTransactionFromPayload,
  resendAndConfirmTransaction,
} from '../solana/solana-data-access';
import { tryDecodeInstruction } from '../solana/solana-utils';
import { ellipsify, useTransactionToast } from '../ui/ui-layout';
import ModalAddInstruction from './modal-add-instruction/ModalAddInstruction';
import {
  SimulateResult,
  decodeTransactionFromPayload,
  move,
  simulateTransaction,
} from './transactions-data-access';

enum Routing {
  PioneerLegends = 'PioneerLegends',
}

interface InstructionProps {
  safe: PublicKey | null;
  compromised: PublicKey | null;
  ix: number;
  i: TransactionInstruction;
  transaction: DecodedTransaction;
  setTransaction: (value: DecodedTransaction) => void;
}

function Instruction({
  safe,
  compromised,
  ix,
  i,
  transaction,
  setTransaction,
}: InstructionProps) {
  const onMoveUp = useCallback(
    () =>
      setTransaction({
        ...transaction,
        instructions: move(transaction.instructions, ix, -1),
      }),
    [transaction, ix]
  );
  const onMoveDown = useCallback(
    () =>
      setTransaction({
        ...transaction,
        instructions: move(transaction.instructions, ix, 1),
      }),
    [transaction]
  );
  const onDelete = useCallback(
    () =>
      setTransaction({
        ...transaction,
        instructions: transaction.instructions.filter((_, dx) => dx !== ix),
      }),
    [transaction]
  );
  const onChangeAccount =
    (sx: number, field: keyof AccountMeta) =>
    (e: ChangeEvent<HTMLInputElement>) =>
      setTransaction({
        ...transaction,
        instructions: transaction.instructions.map((d, dx) =>
          dx === ix
            ? {
                ...d,
                keys: d.keys.map((k, kx) =>
                  kx === sx
                    ? ({
                        pubkey:
                          field === 'pubkey'
                            ? new PublicKey(e.target.value)
                            : k.pubkey,
                        isSigner:
                          field === 'isSigner' ? e.target.checked : k.isSigner,
                        isWritable:
                          field === 'isWritable'
                            ? e.target.checked
                            : k.isWritable,
                      } as AccountMeta)
                    : k
                ),
              }
            : d
        ),
      });
  const onReplaceSigner = (publicKey: PublicKey) => () => {
    const keypair = Keypair.generate();
    setTransaction({
      ...transaction,
      instructions: transaction.instructions.map((i) => ({
        ...i,
        keys: i.keys.map((s) =>
          s.pubkey.equals(publicKey) ? { ...s, pubkey: keypair.publicKey } : s
        ),
      })),
      extraSigners: transaction.extraSigners?.map((e) =>
        e.publicKey.equals(publicKey) ? { keypair, publicKey } : e
      ),
    });
  };
  const parsed = useMemo(() => tryDecodeInstruction(i), [i]);

  return (
    <div className="text-left w-full">
      <hr className="mb-4 mt-4" />
      <div className="flex items-center gap-4">
        <b className="flex-1">Instruction #{ix}</b>
        <button
          className="btn btn-neutral"
          disabled={ix <= 0}
          onClick={onMoveUp}
        >
          ↑
        </button>
        <button
          className="btn btn-neutral"
          disabled={ix >= transaction.instructions.length - 1}
          onClick={onMoveDown}
        >
          ↓
        </button>
        <button className="btn" onClick={onDelete}>
          &times;
        </button>
      </div>
      <div>
        <b>Program:</b>{' '}
        <ExplorerLink
          label={ellipsify(i.programId.toBase58())}
          path={`/account/${i.programId.toBase58()}`}
        />
      </div>
      <div>
        <b>Accounts: </b>
        {i.keys.length === 0 && <i>No accounts required</i>}
        {i.keys.length > 0 && (
          <div className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-2">
            <b>#</b>
            <b>Pubkey</b>
            <b>🔄</b>
            <b>Signer</b>
            <b>Writable</b>
            {i.keys.map((s, sx) => (
              <React.Fragment key={sx}>
                <span>{sx}</span>
                <input
                  className="border flex-1"
                  value={s.pubkey.toBase58()}
                  onChange={onChangeAccount(sx, 'pubkey')}
                />
                {s.isSigner &&
                s.pubkey.toBase58() !== safe?.toBase58() &&
                s.pubkey.toBase58() !== compromised?.toBase58() ? (
                  <button onClick={onReplaceSigner(s.pubkey)}>🔄</button>
                ) : (
                  <span />
                )}
                <input
                  type="checkbox"
                  checked={s.isSigner}
                  onChange={onChangeAccount(sx, 'isSigner')}
                />
                <input
                  type="checkbox"
                  checked={s.isWritable}
                  onChange={onChangeAccount(sx, 'isWritable')}
                />
              </React.Fragment>
            ))}
          </div>
        )}
      </div>
      <div className="text-wrap break-all max-w-40 max-h-20 overflow-auto">
        <b>Data:</b>
        <textarea
          readOnly
          rows={2}
          value={base58.deserialize(new Uint8Array(i.data))[0]}
          className="border block w-full"
        />
      </div>
      {parsed && (
        <div>
          <b>Decoded:</b>
          <pre className="border w-full overflow-auto">
            {JSON.stringify(parsed, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

export function TransactionUi() {
  const wallet = useCompromisedContext();
  const { connection } = useConnection();
  const feePayer = useFeePayerContext();

  const transactionToast = useTransactionToast();

  const [signature, setSignature] = useState('');
  const [payload, setPayload] = useState('');
  const [decoded, setDecoded] = useState<DecodedTransaction>({
    blockhash: '',
    instructions: [],
    signatures: [],
    extraSigners: [],
    version: 0,
  });
  const [preview, setPreview] = useState<SimulateResult | undefined>();
  const [routing, setRouting] = useState<Routing | undefined>();
  const [error, setError] = useState('');

  function startSendTransaction() {
    sendTransaction();
  }
  async function sendTransaction() {
    if (!wallet.publicKey) return;
    if (!feePayer) return;
    if (!payload || payload.length == 0) {
      setError('Error: Payload not defined');
      setSignature('');
      return;
    }

    try {
      let { transaction, blockhash, lastValidBlockHeight } =
        await buildTransactionFromPayload(
          connection,
          decoded!,
          feePayer,
          preview?.unitsConsumed
        );

      transaction = await wallet.signTransaction!(transaction);

      switch (routing) {
        case Routing.PioneerLegends: {
          const result = await fetch(
            'https://pioneerlegends.com:3333/stake/unlock',
            {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                accept: 'application/json',
              },
              body: JSON.stringify({
                encodedTx: transaction
                  .serialize({ requireAllSignatures: false })
                  .toString('base64'),
                user: feePayer.publicKey!.toBase58(),
              }),
            }
          );
          transactionToast(await result.text(), 'confirmed');
          break;
        }
        default:
          const signature = await connection.sendRawTransaction(
            transaction.serialize()
          );
          setSignature(signature);
          setError('');
          transactionToast(signature, 'sent');

          await resendAndConfirmTransaction({
            connection,
            transaction,
            signature,
            blockhash,
            lastValidBlockHeight,
          });
          transactionToast(signature, 'confirmed');
          break;
      }
    } catch (e: any) {
      console.error(e);
      setError(e.toString());
    }
  }

  const handlePayloadChange = async function (event: any) {
    setPayload(event.target.value);
    try {
      const decoded = await decodeTransactionFromPayload(
        connection,
        event.target.value,
        feePayer.publicKey!,
        [feePayer.publicKey!, wallet.publicKey!]
      );
      setDecoded(decoded);
    } catch (e: any) {
      console.error(e);
      setError(e.toString());
    }
  };

  useEffect(() => {
    if (decoded && feePayer.publicKey) {
      simulateTransaction(connection, decoded, feePayer.publicKey!).then((r) =>
        setPreview(r)
      );
    } else {
      setPreview(undefined);
    }
  }, [decoded, feePayer.publicKey]);

  return (
    <div className="max-w-7xl">
      <div className="space-y-4 mt-4">
        <div className="border p-2 flex flex-col gap-2">
          <h2 className="text-2xl font-bold">Step 1: Safe wallet</h2>
          <div>Connect your safe wallet for paying fees and rent</div>
          <FeePayerWalletButton />
        </div>
        {wallet.publicKey &&
          feePayer.publicKey &&
          wallet.publicKey.toBase58() !== feePayer.publicKey.toBase58() && (
            <div className="border p-2 flex flex-col gap-2">
              <h2 className="text-2xl font-bold">Step 2: Payload</h2>
              <div>
                Go to protocol website as usual, use Solflare wallet, and copy
                the payload instead of signing the transaction
              </div>
              <div className="space-x-2"></div>
              <textarea
                name="payload"
                rows={4}
                onChange={handlePayloadChange}
                className="border w-full"
                placeholder="Paste the payload here"
              />
            </div>
          )}

        {!!decoded && feePayer.publicKey && (
          <div className="border p-2 flex flex-col gap-2 items-center">
            <h2 className="text-2xl font-bold">Step 3: Instructions</h2>
            <div>View and edit your transaction for advanced use cases</div>

            <ModalAddInstruction
              decoded={decoded}
              setDecoded={setDecoded}
              preview={preview}
            />

            {!decoded.instructions.length && (
              <div>
                <i>No instructions found</i>
              </div>
            )}
            {decoded.instructions.map((i, ix) => (
              <Instruction
                compromised={wallet.publicKey}
                safe={feePayer.publicKey}
                key={ix}
                i={i}
                ix={ix}
                transaction={decoded}
                setTransaction={setDecoded}
              />
            ))}
          </div>
        )}

        {preview && (
          <div className="border p-2 flex flex-col gap-1">
            <h2 className="text-2xl font-bold">Step 4: Preview</h2>
            <div>Units consumed: {preview.unitsConsumed}</div>
            <h4>Simulation result:</h4>
            {!preview.err && (
              <div className="alert alert-success font-bold p-2 flex justify-center">
                SUCCESS
              </div>
            )}
            {preview.err && (
              <div className="alert alert-warning p-2 flex justify-center">
                <b>ERROR:</b> {JSON.stringify(preview.err, null, 2)}
              </div>
            )}
            <div>Transaction logs:</div>
            <textarea
              value={(preview.logs || []).join('\n')}
              rows={10}
              readOnly
              className="border w-full"
            />
            {preview.accounts && (
              <>
                <h5>Accounts changes:</h5>

                <div className="overflow-auto">
                  <table className="table border border-collapse border-spacing-0 rounded-none p-2 w-full">
                    <thead>
                      <tr>
                        <th>Address</th>
                        <th>Program</th>
                        <th>Authority</th>
                        <th>Before</th>
                        <th>After</th>
                        <th>Change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.addresses.map((a) => (
                        <tr key={a.pubkey}>
                          <td>
                            <ExplorerLink
                              path={`account/${a.pubkey}`}
                              label={ellipsify(a.pubkey)}
                            />
                          </td>
                          <td>
                            <ExplorerLink
                              path={`account/${a.owner?.toBase58()}`}
                              label={ellipsify(a.owner?.toBase58())}
                            />
                          </td>
                          <td>
                            <ExplorerLink
                              path={`account/${(
                                a.after.authority || a.before.authority
                              )?.toBase58()}`}
                              label={ellipsify(
                                (
                                  a.after.authority || a.before.authority
                                )?.toBase58()
                              )}
                            />
                          </td>
                          <td>
                            {a.type === 'token-account' ? (
                              <>
                                <BalanceDisplay
                                  balance={a.before.tokenAmount}
                                  decimals={a.mint?.decimals}
                                />
                                <BalanceDisplay
                                  balance={a.before.lamports}
                                  symbol="SOL"
                                  small
                                />
                              </>
                            ) : (
                              <BalanceDisplay
                                balance={a.before.lamports}
                                symbol="SOL"
                              />
                            )}
                          </td>
                          {!preview.err && (
                            <td>
                              {a.type === 'token-account' ? (
                                <>
                                  <BalanceDisplay
                                    balance={a.after.tokenAmount}
                                    decimals={a.mint?.decimals}
                                  />
                                  <BalanceDisplay
                                    balance={a.after.lamports}
                                    symbol="SOL"
                                    small
                                  />
                                </>
                              ) : (
                                <BalanceDisplay
                                  balance={a.after.lamports}
                                  symbol="SOL"
                                />
                              )}
                            </td>
                          )}
                          {!preview.err && (
                            <td className="inline-flex flex-col gap-1">
                              {a.type === 'token-account' ? (
                                <>
                                  <BalanceChange
                                    from={a.before.tokenAmount}
                                    to={a.after.tokenAmount}
                                    decimals={a.mint?.decimals}
                                  />
                                  <BalanceChange
                                    from={a.before.lamports}
                                    to={a.after.lamports}
                                    symbol="SOL"
                                    small
                                  />
                                </>
                              ) : (
                                <BalanceChange
                                  from={a.before.lamports}
                                  to={a.after.lamports}
                                  symbol="SOL"
                                />
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        {decoded?.extraSigners?.some((e) => !e.keypair) && (
          <div className="border p-2">
            <h2 className="text-2xl font-bold">Step 5: Routing</h2>
            <div>
              Only change this if you need to interact with a protocol that
              requires extra signers
            </div>
            <div className="space-x-2"></div>
            <select
              className="border"
              value={routing}
              onChange={(e) =>
                setRouting((e.target.value as Routing) || undefined)
              }
            >
              <option>None</option>
              <option value={Routing.PioneerLegends}>Pioneer Legends</option>
            </select>
          </div>
        )}

        {error && <div className="alert alert-warning">{error}</div>}
        <button
          className="mt-4 btn btn-2xl btn-primary text-2xl w-full"
          disabled={!payload || !preview || !!preview?.err}
          onClick={() => startSendTransaction()}
        >
          Send Transaction
        </button>
        <div className="space-x-2"></div>
      </div>
    </div>
  );
}

function BalanceDisplay({
  balance = 0,
  decimals = 9,
  symbol = '',
  small = false,
}: {
  balance?: number;
  decimals?: number;
  symbol?: string;
  small?: boolean;
}) {
  const formatter = new Intl.NumberFormat();
  let value = [formatter.format(balance / 10 ** decimals)];
  if (symbol) {
    value.push(symbol);
  }
  return (
    <span className={`whitespace-nowrap block mb-1 ${small && 'text-xs'}`}>
      {value.join(' ')}
    </span>
  );
}
function BalanceChange({
  from = 0,
  to = 0,
  decimals = 9,
  symbol = '',
  small = false,
}: {
  from?: number;
  to?: number;
  decimals?: number;
  symbol?: string;
  small?: boolean;
}) {
  const formatter = new Intl.NumberFormat([], {
    signDisplay: 'exceptZero',
  });
  const diff = to - from;
  if (diff === 0) {
    return null;
  }
  let value = [formatter.format(diff / 10 ** decimals)];
  if (symbol) {
    value.push(symbol);
  }
  return (
    <span
      className={`whitespace-nowrap block alert ${
        diff > 0 ? 'alert-success' : 'alert-warning'
      } py-0 px-2 ${small && 'text-xs'}`}
    >
      {value.join(' ')}
    </span>
  );
}
