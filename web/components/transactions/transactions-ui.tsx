'use client';

import { base58 } from '@metaplex-foundation/umi/serializers';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { AccountMeta, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { useEffect, useState } from 'react';
import { ExplorerLink } from '../cluster/cluster-ui';
import { useFeePayerContext } from '../fee-payer/fee-payer.provider';
import { FeePayerWalletButton } from '../fee-payer/fee-payer.ui';
import { resendAndConfirmTransaction } from '../solana/solana-data-access';
import { WalletButton } from '../solana/solana-provider';
import { ellipsify, useTransactionToast } from '../ui/ui-layout';
import ModalAddInstruction from './modal-add-instruction/ModalAddInstruction';
import {
  DecodedTransaction,
  SimulateResult,
  buildTransactionFromPayload,
  decodeTransactionFromPayload,
  move,
  simulateTransaction,
} from './transactions-data-access';

enum Routing {
  PioneerLegends = 'PioneerLegends',
}

export function TransactionUi() {
  const wallet = useWallet();
  const { connection } = useConnection();
  const feePayer = useFeePayerContext();

  const transactionToast = useTransactionToast();

  const [signature, setSignature] = useState('');
  const [payload, setPayload] = useState('');
  const [decoded, setDecoded] = useState<DecodedTransaction | undefined>();
  const [showAddInstructionModal, setShowAddInstructionModal] = useState(false);
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
          preview!
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
    <div>
      <div className="flex gap-2 items-center justify-center">
        <h2 className="text-xl font-bold">Compromised wallet:</h2>
        <WalletButton />
      </div>
      <div className="space-y-2 mt-2">
        <div>
          <div className="border p-2">
            <h2 className="text-2xl font-bold">
              Step 1: connect your safe wallet
            </h2>
            <FeePayerWalletButton />
          </div>
          {wallet.publicKey &&
            feePayer.publicKey &&
            wallet.publicKey.toBase58() !== feePayer.publicKey.toBase58() && (
              <div className="border p-2 flex flex-col gap-2">
                <h2 className="text-2xl font-bold">
                  Step 2: build transaction
                </h2>
                <div>
                  Go to protocol website as usual, use Solflare wallet, and
                  instead of signing paste payload here:{' '}
                </div>
                <div className="space-x-2"></div>
                <textarea
                  name="payload"
                  rows={4}
                  cols={80}
                  onChange={handlePayloadChange}
                  className="border"
                />
              </div>
            )}

          {!!decoded && feePayer.publicKey && (
            <div className="border p-2">
              <h2 className="text-2xl font-bold">Step 3: advanced only</h2>
              <div>
                View and edit your transaction for further options. Try first
                without modifying this.
              </div>

              <ModalAddInstruction
                decoded={decoded}
                setDecoded={setDecoded}
                preview={preview}
              />

              {decoded.instructions.map((i, ix) => (
                <div key={ix} className="text-left">
                  <hr className="mb-4 mt-4" />
                  <div className="flex items-center gap-4">
                    <b className="flex-1">Instruction #{ix}</b>
                    <button
                      className="btn btn-neutral"
                      disabled={ix <= 0}
                      onClick={() =>
                        setDecoded({
                          ...decoded,
                          instructions: move(decoded.instructions, ix, -1),
                        })
                      }
                    >
                      ↑
                    </button>
                    <button
                      className="btn btn-neutral"
                      disabled={ix >= decoded.instructions.length - 1}
                      onClick={() =>
                        setDecoded({
                          ...decoded,
                          instructions: move(decoded.instructions, ix, 1),
                        })
                      }
                    >
                      ↓
                    </button>
                    <button
                      className="btn btn-error"
                      onClick={() =>
                        setDecoded({
                          ...decoded,
                          instructions: decoded.instructions.filter(
                            (d, dx) => dx !== ix
                          ),
                        })
                      }
                    >
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
                    {i.keys.map((s, sx) => (
                      <div key={sx} className="flex gap-2">
                        <b>#{sx}:</b>
                        <input
                          className="border flex-1"
                          value={s.pubkey.toBase58()}
                          onChange={(e) =>
                            setDecoded({
                              ...decoded,
                              instructions: decoded.instructions.map((d, dx) =>
                                dx === ix
                                  ? {
                                      programId: d.programId,
                                      data: d.data,
                                      keys: d.keys.map((k, kx) =>
                                        kx === sx
                                          ? ({
                                              pubkey: new PublicKey(
                                                e.target.value
                                              ),
                                              isSigner: k.isSigner,
                                              isWritable: k.isWritable,
                                            } as AccountMeta)
                                          : k
                                      ),
                                    }
                                  : d
                              ),
                            })
                          }
                        />
                        {s.isWritable && <span>Writable</span>}
                        {s.isSigner && <b>Signer</b>}
                      </div>
                    ))}
                  </div>
                  <div className="text-wrap break-all max-w-40 max-h-20 overflow-auto">
                    <b>Data:</b>
                    <textarea
                      readOnly
                      rows={2}
                      cols={80}
                      value={base58.deserialize(new Uint8Array(i.data))[0]}
                      className="border block"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {preview && (
            <div className="border p-2 flex flex-col gap-1">
              <h2 className="text-2xl font-bold">
                Step 4: Transaction preview
              </h2>
              <div>Units consumed: {preview.unitsConsumed}</div>
              <h4>Simulation result:</h4>
              {!preview.err && (
                <div className="bg-success font-bold p-2">SUCCESS</div>
              )}
              {preview.err && (
                <div className="bg-error p-2">
                  <b>ERROR:</b> {JSON.stringify(preview.err, null, 2)}
                </div>
              )}
              <div>Transaction logs:</div>
              <textarea
                value={(preview.logs || []).join('\n')}
                rows={10}
                cols={80}
                readOnly
                className="border"
              />
              {preview.accounts && (
                <div>
                  <h5>Accounts changes:</h5>
                  {preview.addresses.map((a) => (
                    <div key={a.pubkey} className="flex gap-2">
                      <ExplorerLink
                        path={`account/${a.pubkey}`}
                        label={ellipsify(a.pubkey)}
                      />
                      <span>
                        owned by:{' '}
                        <ExplorerLink
                          path={`account/${a.owner?.toBase58()}`}
                          label={ellipsify(a.owner?.toBase58())}
                        />
                      </span>
                      <span>
                        before:{' '}
                        {a.type === 'token-account' ? (
                          <>
                            {a.before.tokenAmount || 0}{' '}
                            <small>
                              ({a.before.lamports / LAMPORTS_PER_SOL} SOL)
                            </small>
                          </>
                        ) : (
                          <>{a.before.lamports / LAMPORTS_PER_SOL} SOL</>
                        )}
                      </span>
                      <span>
                        after:{' '}
                        {a.type === 'token-account' ? (
                          <>
                            {a.after.tokenAmount || 0}{' '}
                            <small>
                              ({a.after.lamports / LAMPORTS_PER_SOL} SOL)
                            </small>
                          </>
                        ) : (
                          <>{a.after.lamports / LAMPORTS_PER_SOL} SOL</>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {decoded?.needsExtraSigner && (
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

          <button
            className="mt-4 btn btn-2xl btn-primary text-2xl w-full"
            disabled={!payload || !preview || !!preview?.err}
            onClick={() => startSendTransaction()}
          >
            Send Transaction
          </button>
          <div className="space-x-2"></div>
          <div>
            {error}
            {signature ? 'Signature: ' + signature : ''}
          </div>
        </div>
      </div>
    </div>
  );
}
