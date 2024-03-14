'use client';

import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { AccountMeta, Keypair, PublicKey } from '@solana/web3.js';
import { useEffect, useState } from 'react';
import { AccountBalance } from '../account/account-ui';
import { useCluster } from '../cluster/cluster-data-access';
import { ellipsify, useTransactionToast } from '../ui/ui-layout';
import {
  DecodedTransaction,
  SimulateResult,
  buildTransactionFromPayload,
  decodeTransactionFromPayload,
  getFeepayerForWallet,
  simulateTransaction,
} from './transactions-data-access';
import { ExplorerLink } from '../cluster/cluster-ui';
import { resendAndConfirmTransaction } from '../solana/solana-data-access';

enum Routing {
  PioneerLegends = 'PioneerLegends',
}

export function TransactionUi() {
  const wallet = useWallet();
  const { connection } = useConnection();

  const transactionToast = useTransactionToast();

  const [feepayer, setFeePayer] = useState<Keypair | undefined>();
  const [signature, setSignature] = useState('');
  const [payload, setPayload] = useState('');
  const [decoded, setDecoded] = useState<DecodedTransaction | undefined>();
  const [preview, setPreview] = useState<SimulateResult | undefined>();
  const [routing, setRouting] = useState<Routing | undefined>();
  const [error, setError] = useState('');
  useEffect(() => {
    if (!wallet.publicKey) return;
    const fp = getFeepayerForWallet(wallet.publicKey);
    setFeePayer(fp);
  }, [wallet]);
  function startSendTransaction() {
    sendTransaction();
  }
  async function sendTransaction() {
    if (!wallet.publicKey) return;
    if (!feepayer) return;
    if (!payload || payload.length == 0) {
      setError('Error: Payload not defined');
      setSignature('');
      return;
    }

    try {
      let { transaction, lastValidBlockHeight } =
        await buildTransactionFromPayload(
          connection,
          decoded!,
          feepayer,
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
                user: feepayer.publicKey.toBase58(),
              }),
            }
          );
          transactionToast(await result.text());
          break;
        }
        default:
          const signature = await connection.sendRawTransaction(
            transaction.serialize(),
            {
              maxRetries: 0,
            }
          );
          setSignature(signature);
          setError('');
          await resendAndConfirmTransaction({
            connection,
            transaction,
            lastValidBlockHeight,
            signature,
          });
          transactionToast(signature);
          break;
      }
    } catch (e: any) {
      setError(e.toString());
    }
  }

  const handlePayloadChange = async function (event: any) {
    setPayload(event.target.value);
    try {
      const decoded = await decodeTransactionFromPayload(
        connection,
        event.target.value,
        [feepayer!.publicKey, wallet.publicKey!]
      );
      setDecoded(decoded);
    } catch (e: any) {
      setError(e.toString());
    }
  };

  useEffect(() => {
    if (decoded && feepayer) {
      simulateTransaction(connection, decoded, feepayer).then((r) =>
        setPreview(r)
      );
    } else {
      setPreview(undefined);
    }
  }, [decoded, feepayer]);

  return (
    <div>
      <div className="space-y-2">
        {!wallet.publicKey || !feepayer ? (
          <h2 className="text-2xl font-bold">Please connect your wallet!</h2>
        ) : (
          <div>
            <div className="border p-2">
              <h2 className="text-2xl font-bold">Step 1: fund this keypair</h2>
              <div className="flex justify-between">
                <div className="space-x-2"></div>
                <div>Send some SOL to {feepayer.publicKey.toBase58()} </div>

                <div className="">
                  current balance:{' '}
                  <AccountBalance address={feepayer.publicKey}></AccountBalance>
                </div>
              </div>
            </div>
            <div className="border p-2">
              <h2 className="text-2xl font-bold">Step 2: build transaction</h2>
              <div className="space-x-2"></div>
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

            {!!decoded && (
              <div className="border p-2">
                <h2 className="text-2xl font-bold">Step 3: advanced only</h2>
                <div>
                  View and edit your transaction for further options. Try first
                  without modifying this.
                </div>
                {decoded.instructions.map((i, ix) => (
                  <div key={ix}>
                    <div>Instruction #{ix}</div>
                    <div>Program: {i.programId.toBase58()}</div>
                    <div>
                      Accounts:{' '}
                      {i.keys.map((s, sx) => (
                        <div key={sx} className="flex gap-2">
                          <span>#{sx}:</span>
                          <input
                            className="border flex-1"
                            value={s.pubkey.toBase58()}
                            onChange={(e) =>
                              setDecoded({
                                ...decoded,
                                instructions: decoded.instructions.map(
                                  (d, dx) =>
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
                      Data: {new Uint8Array(i.data).toString()}
                    </div>
                    <hr className="mb-2" />
                  </div>
                ))}
              </div>
            )}

            {preview && (
              <div className="border p-2">
                <h2 className="text-2xl font-bold">
                  Step 4: Transaction preview
                </h2>
                <div>Units consumed: {preview.unitsConsumed}</div>
                <div>Here you can see the logs of the transaction:</div>
                <div className="space-x-2"></div>
                {preview.err && <div>Error: {preview.err.toString()}</div>}
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
                        <span>before: {Number(a.before || 0)}</span>
                        <span>after: {Number(a.after || 0)}</span>
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
                  <option value={Routing.PioneerLegends}>
                    Pioneer Legends
                  </option>
                </select>
              </div>
            )}

            <button
              className="mt-4 btn btn-xl lg:btn-md btn-primary text-2xl"
              disabled={!payload}
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
        )}
      </div>
    </div>
  );
}
