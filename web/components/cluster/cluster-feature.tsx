'use client';

import { AppHero, AppModal } from '../ui/ui-layout';
import { ClusterUiModal, ClusterUiTable } from './cluster-ui';

export default function ClusterFeature() {
  return (
    <div>
      <AppHero
        title="Clusters"
        subtitle="Manage and select your Solana clusters"
        HelpModal={ModalHelp}
      >
        <ClusterUiModal />
      </AppHero>
      <ClusterUiTable />
    </div>
  );
}

function ModalHelp() {
  return (
    <AppModal
      title="Clusters"
      buttonLabel="?"
      buttonClassName="btn-sm btn-circle btn-neutral text-xl"
    >
      <div className="text-left">
        <div className="mb-2 italic text-lg">
          Setup your connection to the blockchain
        </div>
        <summary>
          Manage your RPC cluster connections and which network to connect to.
        </summary>
        <summary>
          Add a cluster from your private RPC for improved performance. You may
          create one for yourself (for free) at{' '}
          <a href="https://dev.helius.xyz/dashboard/app" target="_blank">
            Helius
          </a>{' '}
          or{' '}
          <a href="https://app.extrnode.com" target="_blank">
            Extrnode
          </a>
          .
        </summary>
      </div>
    </AppModal>
  );
}
