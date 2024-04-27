'use client';
import {
  ChangeEvent,
  Component,
  ReactNode,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { SolanaProvider, WalletButton } from '../solana/solana-provider';

import { isPublicKey } from '@metaplex-foundation/umi';
import { WalletContextState, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { createContext, useContext } from 'react';
import {
  HtmlPortalNode,
  InPortal,
  createHtmlPortalNode,
} from 'react-reverse-portal';
import { IS_DEV } from '../constants';

const FeePayerContext = createContext<WalletContextState>(
  {} as WalletContextState
);

export const useFeePayerContext = () => useContext(FeePayerContext);

function useFeePayer(address: string): WalletContextState {
  const wallet = useWallet();
  const mockWallet = useMemo<WalletContextState | undefined>(() => {
    if (isPublicKey(address)) {
      return {
        publicKey: new PublicKey(address),
      } as WalletContextState;
    }
  }, [address]);

  return mockWallet || wallet;
}

const FeePayerUIContext = createContext<HtmlPortalNode<Component> | null>(null);
export const useFeePayerUIContext = () => useContext(FeePayerUIContext);

export function FeePayerStore({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState('');
  const context = useFeePayer(address);
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    setIsMounted(true);
  }, []);
  const portalNode = useMemo(
    () => (isMounted ? createHtmlPortalNode() : null),
    [isMounted]
  );

  return (
    <FeePayerContext.Provider value={context}>
      {portalNode ? (
        <FeePayerUIContext.Provider value={portalNode}>
          <InPortal node={portalNode}>
            <fieldset className="flex items-center gap-2">
              <WalletButton />
              {IS_DEV && (
                <>
                  <label>OR</label>
                  <input
                    value={address}
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      setAddress(e.target.value)
                    }
                    className="border"
                  />
                </>
              )}
            </fieldset>
          </InPortal>
          {children}
        </FeePayerUIContext.Provider>
      ) : (
        children
      )}
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
