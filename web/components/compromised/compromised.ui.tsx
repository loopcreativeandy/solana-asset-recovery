'use client';

import { OutPortal } from 'react-reverse-portal';
import { useCompromisedUIContext } from './compromised.provider';

export function CompromisedWalletButton() {
  const portalNode = useCompromisedUIContext();

  return portalNode && <OutPortal node={portalNode} />;
}
