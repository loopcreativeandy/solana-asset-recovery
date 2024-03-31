'use client';

import { Component, ReactNode, useMemo } from 'react';
import { SolanaProvider, WalletButton } from '../solana/solana-provider';

import { WalletContextState, useWallet } from '@solana/wallet-adapter-react';
import { createContext, useContext } from 'react';
import {
  HtmlPortalNode,
  InPortal,
  createHtmlPortalNode,
} from 'react-reverse-portal';

const FeePayerContext = createContext<WalletContextState>(
  {} as WalletContextState
);

export const useFeePayerContext = () => useContext(FeePayerContext);

function useFeePayer(): WalletContextState {
  const wallet = useWallet();

  return wallet;
}

const FeePayerUIContext = createContext<HtmlPortalNode<Component>>(
  {} as HtmlPortalNode<Component>
);
export const useFeePayerUIContext = () => useContext(FeePayerUIContext);

export function FeePayerStore({ children }: { children: React.ReactNode }) {
  const context = useFeePayer();
  const portalNode = useMemo(() => createHtmlPortalNode(), []);

  return (
    <FeePayerContext.Provider value={context}>
      <FeePayerUIContext.Provider value={portalNode}>
        <InPortal node={portalNode}>
          <WalletButton />
        </InPortal>
        {children}
      </FeePayerUIContext.Provider>
    </FeePayerContext.Provider>
  );
}

export function FeePayerProvider({ children }: { children: ReactNode }) {
  return (
    <SolanaProvider localStorageKey="feePayer">
      <FeePayerStore>{children}</FeePayerStore>
    </SolanaProvider>
  );
}
