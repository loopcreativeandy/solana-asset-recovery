import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  decodeInstruction,
} from '@solana/spl-token';
import {
  AccountMeta,
  AllocateParams,
  ComputeBudgetInstruction,
  ComputeBudgetProgram,
  CreateAccountParams,
  PublicKey,
  SetComputeUnitLimitParams,
  SetComputeUnitPriceParams,
  SystemInstruction,
  SystemProgram,
  TransactionInstruction,
  TransferParams,
} from '@solana/web3.js';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

export type DecodedInstruction =
  | DecodedSystemInstruction
  | DecodedComputeBudgetInstruction
  | DecodedTokenInstruction
  | DecodedAssociatedTokenInstruction;
export type DecodedSystemInstruction =
  | undefined
  | ({
      type: 'Allocate';
    } & AllocateParams)
  | ({ type: 'Create' } & CreateAccountParams)
  | ({ type: 'Transfer' } & TransferParams);

function decodeSystemInstruction(
  instruction: TransactionInstruction
): DecodedSystemInstruction {
  const type = SystemInstruction.decodeInstructionType(instruction);
  switch (type) {
    case 'Allocate':
      return {
        type,
        ...SystemInstruction.decodeAllocate(instruction),
      };
    case 'Create':
      return {
        type,
        ...SystemInstruction.decodeCreateAccount(instruction),
      };
    case 'Transfer':
      return {
        type,
        ...SystemInstruction.decodeTransfer(instruction),
      };
  }
}

export type DecodedComputeBudgetInstruction =
  | undefined
  | ({ type: 'SetComputeUnitLimit' } & SetComputeUnitLimitParams)
  | ({ type: 'SetComputeUnitPrice' } & SetComputeUnitPriceParams);

function decodeComputeBudgetInstruction(
  instruction: TransactionInstruction
): DecodedComputeBudgetInstruction {
  const type = ComputeBudgetInstruction.decodeInstructionType(instruction);
  switch (type) {
    case 'SetComputeUnitLimit':
      return {
        type,
        ...ComputeBudgetInstruction.decodeSetComputeUnitLimit(instruction),
      };
    case 'SetComputeUnitPrice':
      return {
        type,
        ...ComputeBudgetInstruction.decodeSetComputeUnitPrice(instruction),
      };
  }
}

export type DecodedTokenInstruction =
  | undefined
  | { keys: Record<string, PublicKey | undefined>; data: any };

function mapDecodedTokenInstruction({
  keys,
  data,
}: {
  keys: Record<string, AccountMeta | AccountMeta[] | undefined>;
  data: any;
}): DecodedTokenInstruction {
  return {
    ...Object.entries(keys).reduce(
      (res, [k, a]) => ({
        ...res,
        [k]: Array.isArray(a) ? a.map((a) => a.pubkey) : a?.pubkey,
      }),
      {}
    ),
    ...data,
  };
}
function decodeTokenInstruction(
  instruction: TransactionInstruction
): DecodedTokenInstruction {
  return mapDecodedTokenInstruction(decodeInstruction(instruction));
}

export type DecodedAssociatedTokenInstruction = undefined;

function decodeAssociatedTokenInstruction(
  instruction: TransactionInstruction
): DecodedAssociatedTokenInstruction {
  const type = instruction.data.toString();
  console.info(type);
}

export function tryDecodeInstruction(
  instruction: TransactionInstruction
): DecodedInstruction | undefined {
  switch (instruction.programId.toBase58()) {
    case SystemProgram.programId.toBase58():
      return decodeSystemInstruction(instruction);
    case ComputeBudgetProgram.programId.toBase58():
      return decodeComputeBudgetInstruction(instruction);
    case TOKEN_PROGRAM_ID.toBase58():
      return decodeTokenInstruction(instruction);
    case ASSOCIATED_TOKEN_PROGRAM_ID.toBase58():
      return decodeAssociatedTokenInstruction(instruction);
  }
}
