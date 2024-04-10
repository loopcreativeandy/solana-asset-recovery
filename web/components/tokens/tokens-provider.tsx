'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { ParsedTokenAccount } from '../account/account-data-access';

export interface TokenInfo {
  address: string;
  decimals: number;
  name: string;
  symbol: string;
  logoURI: string;
}

export interface PriceInfo {
  id: string;
  mintSymbol: string;
  vsToken: string;
  vsTokenSymbol: string;
  price: number;
}

interface TokensContextProps {
  tokens: Record<string, TokenInfo>;
  getPrices: (
    accounts: ParsedTokenAccount[]
  ) => Promise<Record<string, PriceInfo>>;
}

const TokensContext = createContext<TokensContextProps>({
  tokens: {},
  getPrices: () => Promise.resolve({}),
});

export const useTokensContext = () => useContext(TokensContext);

function useTokens(): TokensContextProps {
  const [tokens, setTokens] = useState<Record<string, TokenInfo>>({});

  const getPrices = useCallback(
    async (accounts: ParsedTokenAccount[]) => {
      const ids = accounts.reduce<string[]>(
        (
          res,
          {
            account: {
              data: {
                parsed: {
                  info: { mint },
                },
              },
            },
          }
        ) => (tokens[mint] ? [...res, mint] : res),
        []
      );
      const prices: { data: Record<string, PriceInfo> } = await fetch(
        `https://price.jup.ag/v4/price?ids=${ids.join(',')}`
      ).then((r) => r.json());
      return prices.data;
    },
    [tokens]
  );

  useEffect(() => {
    (async function () {
      const tokens: TokenInfo[] = await fetch(
        'https://token.jup.ag/strict'
      ).then((r) => r.json());
      setTokens(tokens.reduce((res, t) => ({ ...res, [t.address]: t }), {}));
    })();
  }, []);

  return { tokens, getPrices };
}

export function TokensProvider({ children }: { children: React.ReactNode }) {
  const context = useTokens();

  return (
    <TokensContext.Provider value={context}>{children}</TokensContext.Provider>
  );
}
