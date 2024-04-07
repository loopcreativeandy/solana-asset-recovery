'use client';

import { useState } from 'react';
import { AppHero, AppModal } from '../ui/ui-layout';
import { ClusterUiModal } from './cluster-ui';
import { ClusterUiTable } from './cluster-ui';

export default function ClusterFeature() {
  const [showModal, setShowModal] = useState(false);

  return (
    <div>
      <AppHero
        title="Clusters"
        subtitle="Manage and select your Solana clusters"
      >
        <ModalHelp />
        <ClusterUiModal
          show={showModal}
          hideModal={() => setShowModal(false)}
        />
        <button
          className="btn btn-xs lg:btn-md btn-primary"
          onClick={() => setShowModal(true)}
        >
          Add Cluster
        </button>
      </AppHero>
      <ClusterUiTable />
    </div>
  );
}

function ModalHelp() {
  const [show, setShow] = useState(false);

  return (
    <>
      <button
        className="btn btn-circle btn-info text-2xl fixed top-20 right-2"
        onClick={() => setShow(true)}
      >
        ?
      </button>
      <AppModal hide={() => setShow(false)} show={show} title="Clusters">
        <div className="text-left">
          <div className="mb-2 italic text-lg">
            Setup your connection to the blockchain
          </div>
          <summary>
            Manage your RPC cluster connections and which network to connect to.
          </summary>
          <summary>
            Add a cluster from your private RPC for improved performance. You
            may create one for yourself (for free) at{' '}
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
    </>
  );
}
