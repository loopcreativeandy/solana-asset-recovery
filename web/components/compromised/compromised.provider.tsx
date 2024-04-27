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

const CompromisedContext = createContext<WalletContextState>(
  {} as WalletContextState
);

export const useCompromisedContext = () => useContext(CompromisedContext);

function useCompromised(address: string): WalletContextState {
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

const CompromisedUIContext = createContext<HtmlPortalNode<Component> | null>(
  null
);
export const useCompromisedUIContext = () => useContext(CompromisedUIContext);

export function CompromisedStore({ children }: { children: React.ReactNode }) {
  const [compromisedAddress, setCompromisedAddress] = useState('');
  const context = useCompromised(compromisedAddress);
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    setIsMounted(true);
  }, []);
  const portalNode = useMemo(
    () => (isMounted ? createHtmlPortalNode() : null),
    [isMounted]
  );

  return (
    <CompromisedContext.Provider value={context}>
      {portalNode ? (
        <CompromisedUIContext.Provider value={portalNode}>
          <InPortal node={portalNode}>
            <fieldset className="flex items-center gap-2">
              <WalletButton />
              {IS_DEV && (
                <>
                  <label>OR</label>
                  <input
                    value={compromisedAddress}
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      setCompromisedAddress(e.target.value)
                    }
                    className="border"
                  />
                </>
              )}
            </fieldset>
          </InPortal>
          {children}
        </CompromisedUIContext.Provider>
      ) : (
        children
      )}
    </CompromisedContext.Provider>
  );
}

export function CompromisedProvider({ children }: { children: ReactNode }) {
  return (
    <SolanaProvider localStorageKey="compromised">
      <CompromisedStore>{children}</CompromisedStore>
    </SolanaProvider>
  );
}
