import {
  getBrickInstructions,
  getUmi,
} from '@/components/account/account-data-access';
import { useCompromisedContext } from '@/components/compromised/compromised.provider';
import { useFeePayerContext } from '@/components/fee-payer/fee-payer.provider';
import { AppModal, ellipsify } from '@/components/ui/ui-layout';
import {
  findTokenRecordPda,
  getTokenRecordSize,
} from '@metaplex-foundation/mpl-token-metadata';
import { findAssociatedTokenPda } from '@metaplex-foundation/mpl-toolbox';
import { isPublicKey, publicKey } from '@metaplex-foundation/umi';
import { toWeb3JsPublicKey } from '@metaplex-foundation/umi-web3js-adapters';
import {
  AuthorityType,
  createCloseAccountInstruction,
  createSetAuthorityInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
  getMint,
} from '@solana/spl-token';
import { useConnection } from '@solana/wallet-adapter-react';
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram } from '@solana/web3.js';
import { ChangeEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  DecodedTransaction,
  SimulateResult,
  getCreateATA,
} from '../transactions-data-access';

export type AddInstructionType =
  | 'create-ata'
  | 'transfer-sol'
  | 'transfer-spl'
  | 'set-authority-spl'
  | 'fund-account'
  | 'prepare-pnft-transfer'
  | 'unbrick'
  | 'brick';

export default function ModalAddInstruction({
  decoded,
  setDecoded,
  preview,
}: {
  decoded: DecodedTransaction;
  setDecoded: (decoded: DecodedTransaction) => void;
  preview?: SimulateResult;
}) {
  const { connection } = useConnection();
  const wallet = useCompromisedContext();
  const feePayer = useFeePayerContext();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [bytes, setBytes] = useState('');
  const [mint, setMint] = useState('');
  const fromOwner = useMemo(
    () =>
      preview?.addresses
        .find((a) => a.pubkey === from)
        ?.before.authority?.toBase58() || '',
    [from, preview]
  );

  const handleAddATA = useCallback(() => {
    setDecoded({
      ...decoded!,
      instructions: [
        getCreateATA(
          feePayer.publicKey!,
          wallet.publicKey!,
          new PublicKey(mint)
        ),
        ...decoded!.instructions,
      ],
    });
  }, [decoded, wallet.publicKey, feePayer, mint]);

  const handleAddTransferSOL = useCallback(() => {
    setDecoded({
      ...decoded!,
      instructions: [
        ...decoded!.instructions,
        SystemProgram.transfer({
          fromPubkey: new PublicKey(from),
          toPubkey: new PublicKey(to),
          lamports: Math.round(parseFloat(amount) * LAMPORTS_PER_SOL),
        }),
      ],
    });
  }, [decoded, from, to, amount]);

  const handleAddTransferSPL = useCallback(async () => {
    const mintPubkey = new PublicKey(mint);
    const mintAccount = await getMint(connection, mintPubkey);
    if (!mintAccount) {
      return alert(`Mint ${mint} not found`);
    }
    const fromATA = getAssociatedTokenAddressSync(
      mintPubkey,
      new PublicKey(from),
      true
    );
    const toATA = getAssociatedTokenAddressSync(
      mintPubkey,
      new PublicKey(to),
      true
    );
    setDecoded({
      ...decoded!,
      instructions: [
        ...decoded!.instructions,
        createTransferInstruction(
          fromATA,
          toATA,
          new PublicKey(from),
          Math.round(parseFloat(amount) * 10 ** mintAccount.decimals)
        ),
      ],
    });
  }, [connection, decoded, from, to, amount, mint]);

  const handleAddSetAuthoritySPL = useCallback(async () => {
    const owner = preview?.addresses.find((a) => a.pubkey === from)?.before
      .authority!;
    setDecoded({
      ...decoded!,
      instructions: [
        ...decoded!.instructions,
        createSetAuthorityInstruction(
          new PublicKey(from),
          owner,
          AuthorityType.AccountOwner,
          new PublicKey(to)
        ),
      ],
    });
  }, [decoded, from, to, preview]);

  const handleAddPreparePnftTransfer = useCallback(async () => {
    let instructions = [...decoded!.instructions];
    const umi = getUmi(connection, feePayer.publicKey!.toBase58());
    const [token] = findAssociatedTokenPda(umi, {
      mint: publicKey(mint),
      owner: publicKey(to),
    });
    const [tokenRecord] = findTokenRecordPda(umi, {
      mint: publicKey(mint),
      token,
    });
    const balance = await umi.rpc.getBalance(tokenRecord);
    const tokenRecordRentNeeded = await umi.rpc.getRent(getTokenRecordSize());

    console.info(
      balance.basisPoints,
      tokenRecordRentNeeded.basisPoints,
      Number(tokenRecordRentNeeded.basisPoints) - Number(balance.basisPoints)
    );
    if (
      Number(balance.basisPoints) < Number(tokenRecordRentNeeded.basisPoints)
    ) {
      instructions.unshift(
        SystemProgram.transfer({
          fromPubkey: feePayer.publicKey!,
          toPubkey: toWeb3JsPublicKey(tokenRecord),
          lamports:
            Number(tokenRecordRentNeeded.basisPoints) -
            Number(balance.basisPoints),
        })
      );
    }
    setDecoded({
      ...decoded!,
      instructions,
    });
  }, [connection, feePayer, decoded, from, to, mint]);

  const handleAddFundAccount = useCallback(async () => {
    let instructions = [...decoded!.instructions];
    instructions.unshift(
      SystemProgram.transfer({
        fromPubkey: feePayer.publicKey!,
        toPubkey: new PublicKey(to),
        lamports: Math.round(+amount * LAMPORTS_PER_SOL),
      })
    );
    setDecoded({
      ...decoded!,
      instructions,
    });
  }, [connection, feePayer, decoded, to, amount]);

  const MIN_SOL_FOR_UNBRICK = 0.005;
  const handleAddUnbrick = useCallback(() => {
    const lamports = +amount * LAMPORTS_PER_SOL;
    console.log(amount + ' - adding ' + lamports + ' to unbricked account');
    setDecoded({
      ...decoded!,
      instructions: [
        createCloseAccountInstruction(
          wallet.publicKey!,
          feePayer.publicKey!,
          feePayer.publicKey!
        ),
        SystemProgram.transfer({
          fromPubkey: feePayer.publicKey!,
          toPubkey: wallet.publicKey!,
          lamports,
        }),
        ...decoded!.instructions,
      ],
    });
  }, [decoded, wallet.publicKey, feePayer, amount]);
  const handleAddBrick = useCallback(() => {
    setDecoded({
      ...decoded!,
      instructions: [
        ...decoded!.instructions,
        ...getBrickInstructions(wallet.publicKey!, feePayer.publicKey!),
      ],
    });
  }, [decoded, wallet.publicKey, feePayer]);

  const [ixType, setIxType] = useState<AddInstructionType | ''>('');
  useEffect(() => {
    setAmount('');
    setBytes('');
    setFrom('');
    setTo('');
    setMint('');
    if (ixType === 'unbrick') {
      setAmount(MIN_SOL_FOR_UNBRICK.toString());
    }
  }, [ixType]);

  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!show) {
      setIxType('');
    }
  }, [show]);

  const valid = useMemo(() => {
    switch (ixType) {
      case 'create-ata':
        return isPublicKey(mint);
      case 'transfer-sol':
        return parseFloat(amount) > 0 && isPublicKey(from) && isPublicKey(to);
      case 'transfer-spl':
        return (
          parseFloat(amount) > 0 &&
          isPublicKey(from) &&
          isPublicKey(to) &&
          isPublicKey(mint)
        );
      case 'prepare-pnft-transfer':
        return isPublicKey(mint) && isPublicKey(to);
      case 'fund-account':
        return (
          isPublicKey(to) && (parseInt(bytes) >= 0 || parseFloat(amount) > 0)
        );
      case 'set-authority-spl':
        return isPublicKey(from) && isPublicKey(to);
      case 'unbrick':
        return parseFloat(amount) >= MIN_SOL_FOR_UNBRICK;
      case 'brick':
        return true;
      default:
        return false;
    }
  }, [ixType, from, to, amount, bytes, mint]);

  return (
    <>
      <button className="btn btn-neutral" onClick={() => setShow(true)}>
        Add Instruction
      </button>
      <AppModal
        hide={() => setShow(false)}
        show={show}
        title="Add Instruction"
        submitDisabled={!valid}
        submitLabel="Add"
        submit={() => {
          switch (ixType) {
            case 'create-ata':
              return handleAddATA();
            case 'transfer-sol':
              return handleAddTransferSOL();
            case 'transfer-spl':
              return handleAddTransferSPL();
            case 'set-authority-spl':
              return handleAddSetAuthoritySPL();
            case 'prepare-pnft-transfer':
              return handleAddPreparePnftTransfer();
            case 'fund-account':
              return handleAddFundAccount();
            case 'unbrick':
              return handleAddUnbrick();
            case 'brick':
              return handleAddBrick();
            default:
              return;
          }
        }}
      >
        <fieldset className="flex items-center gap-2">
          <label>Instruction:</label>
          <select
            className="border flex-1"
            value={ixType}
            onChange={(e: ChangeEvent<HTMLSelectElement>) =>
              setIxType(e.target.value as AddInstructionType)
            }
          >
            <option value="" disabled>
              Pick
            </option>
            <option value="create-ata">Create Token Account</option>
            <option value="transfer-sol">Transfer SOL</option>
            <option value="transfer-spl">Transfer Tokens</option>
            <option value="set-authority-spl">
              Set Authority Token Account
            </option>
            <option value="prepare-pnft-transfer">Prepare pNFT Transfer</option>
            <option value="fund-account">Fund Account</option>
            <option value="unbrick">Unbrick</option>
            <option value="brick">Brick</option>
          </select>
        </fieldset>
        {(ixType === 'create-ata' || ixType === 'prepare-pnft-transfer') && (
          <fieldset className="flex items-center gap-2">
            <label>Mint:</label>
            <select
              className="border flex-1"
              value={mint}
              onChange={(e: ChangeEvent<HTMLSelectElement>) => {
                setMint(e.target.value);
              }}
            >
              <option value="" disabled>
                Pick
              </option>
              {preview?.addresses
                .filter((a) => a.type === 'mint')
                .map((a) => (
                  <option key={a.pubkey} value={a.pubkey}>
                    {ellipsify(a.pubkey)}
                  </option>
                ))}
            </select>
          </fieldset>
        )}
        {ixType === 'prepare-pnft-transfer' && (
          <fieldset className="flex items-center gap-2">
            <label>For:</label>
            <select
              className="border flex-1"
              value={to}
              onChange={(e: ChangeEvent<HTMLSelectElement>) => {
                setTo(e.target.value);
              }}
            >
              <option value="" disabled>
                Pick
              </option>
              <option value={wallet.publicKey?.toBase58()}>
                Compromised wallet
              </option>
              <option value={feePayer.publicKey?.toBase58()}>
                Safe wallet
              </option>
            </select>
          </fieldset>
        )}
        {ixType === 'set-authority-spl' && (
          <>
            <div className="bg-warning p-2">
              Be careful! This may cause irreversible changes if transferred to
              a wallet you do not control. Proceed with caution.
            </div>
            <fieldset className="flex items-center gap-2">
              <label>Token Account:</label>
              <select
                className="border flex-1"
                value={from}
                onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                  setFrom(e.target.value)
                }
              >
                <option value="" disabled>
                  Pick
                </option>
                {preview?.addresses
                  .filter((a) => a.type === 'token-account')
                  .map((a) => (
                    <option key={a.pubkey} value={a.pubkey}>
                      {ellipsify(a.pubkey)}
                    </option>
                  ))}
              </select>
            </fieldset>
            <fieldset className="flex items-center gap-2">
              <label>From:</label>
              <select disabled value={fromOwner} className="border flex-1">
                <option>Other</option>
                <option value={wallet.publicKey?.toBase58()}>
                  Compromised wallet
                </option>
                <option value={feePayer.publicKey?.toBase58()}>
                  Safe wallet
                </option>
              </select>
            </fieldset>
            <fieldset className="flex items-center gap-2">
              <label>To:</label>
              <select
                className="border flex-1"
                value={to}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => {
                  setTo(e.target.value);
                }}
              >
                <option value="" disabled>
                  Pick
                </option>
                <option value={wallet.publicKey?.toBase58()}>
                  Compromised wallet
                </option>
                <option value={feePayer.publicKey?.toBase58()}>
                  Safe wallet
                </option>
              </select>
            </fieldset>
          </>
        )}
        {(ixType === 'transfer-sol' || ixType === 'transfer-spl') && (
          <>
            <fieldset className="flex items-center gap-2">
              <label>From:</label>
              <select
                className="border flex-1"
                value={from}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => {
                  setFrom(e.target.value);
                }}
              >
                <option value="" disabled>
                  Pick
                </option>
                <option value={wallet.publicKey?.toBase58()}>
                  Compromised wallet
                </option>
                <option value={feePayer.publicKey?.toBase58()}>
                  Safe wallet
                </option>
              </select>
            </fieldset>
            <fieldset className="flex items-center gap-2">
              <label>To:</label>
              <input
                className="border flex-1"
                value={to}
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  setTo(e.target.value);
                }}
              />
            </fieldset>
            {ixType === 'transfer-spl' && (
              <fieldset className="flex items-center gap-2">
                <label>Mint:</label>
                <input
                  className="border flex-1"
                  value={mint}
                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                    setMint(e.target.value)
                  }
                />
              </fieldset>
            )}
            <fieldset className="flex items-center gap-2">
              <label>Amount:</label>
              <input
                className="border flex-1"
                type="number"
                min={0}
                value={amount}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setAmount(e.target.value)
                }
              />
            </fieldset>
          </>
        )}
        {ixType === 'fund-account' && (
          <>
            <fieldset className="flex items-center gap-2">
              <label>From:</label>
              <input className="border flex-1" value="Safe wallet" readOnly />
            </fieldset>
            <fieldset className="flex items-center gap-2">
              <label>Account:</label>
              <select
                className="border flex-1"
                value={to}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => {
                  setTo(e.target.value);
                }}
              >
                <option value="" disabled>
                  Pick
                </option>
                {preview?.addresses
                  .filter((a) => a.writable)
                  .sort((a, b) => a.before.lamports - b.before.lamports)
                  .map((a) => (
                    <option key={a.pubkey} value={a.pubkey}>
                      {ellipsify(a.pubkey)} (
                      {a.before.lamports / LAMPORTS_PER_SOL} SOL)
                    </option>
                  ))}
              </select>
            </fieldset>
            <fieldset className="flex items-center gap-2">
              <label>Bytes:</label>
              <input
                className="border flex-1"
                type="tel"
                min={0}
                value={bytes}
                onChange={async (e: ChangeEvent<HTMLInputElement>) => {
                  setBytes(e.target.value);
                  const bytes = parseInt(e.target.value);
                  if (bytes >= 0) {
                    setAmount(
                      (
                        (await connection.getMinimumBalanceForRentExemption(
                          bytes
                        )) / LAMPORTS_PER_SOL
                      ).toString()
                    );
                  }
                }}
              />
            </fieldset>
            <span>OR</span>
            <fieldset className="flex items-center gap-2">
              <label>Amount:</label>
              <input
                className="border flex-1"
                type="number"
                value={amount}
                onChange={async (e: ChangeEvent<HTMLInputElement>) => {
                  setAmount(e.target.value);
                  const amount = parseFloat(e.target.value);
                  if (amount > 0) {
                    setBytes('');
                  }
                }}
              />
            </fieldset>
          </>
        )}

        {ixType === 'unbrick' && (
          <fieldset className="flex items-center gap-2">
            <label>Add SOL to use:</label>
            <input
              className="border flex-1"
              type="number"
              step={0.01}
              min={MIN_SOL_FOR_UNBRICK}
              value={amount}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                setAmount(e.target.value)
              }
            />
          </fieldset>
        )}
      </AppModal>
    </>
  );
}
