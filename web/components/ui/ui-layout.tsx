'use client';

import {
  ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import toast, { Toaster } from 'react-hot-toast';
import { AccountChecker } from '../account/account-ui';
import {
  ClusterChecker,
  ClusterUiSelect,
  ExplorerLink,
} from '../cluster/cluster-ui';

const pages: { label: string; path: string }[] = [
  { label: 'Clusters', path: '/clusters' },
  { label: 'Account', path: '/account' },
  { label: 'Transactions', path: '/transactions' },
];

export function UiLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex flex-col min-h-full">
      <div className="navbar bg-purple-400 items-end sm:items-center">
        <div className="flex-1 flex flex-col sm:flex-row items-start sm:items-center">
          <Link className="btn btn-ghost normal-case text-xl" href="/">
            <img
              className="h-4 md:h-6"
              alt="Solana Logo"
              src="/solandy-logo.png"
            />
          </Link>
          <ul className="menu menu-horizontal flex gap-2 p-0">
            {pages.map(({ label, path }) => (
              <li key={path}>
                <Link
                  className={`no-underline p-1 sm:p-2 ${
                    pathname.startsWith(path) ? 'active' : ''
                  }`}
                  href={path}
                >
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <ClusterUiSelect />
        </div>
      </div>
      <ClusterChecker>
        <AccountChecker />
      </ClusterChecker>
      <div className="flex-grow mx-4 lg:mx-auto">
        <Suspense
          fallback={
            <div className="text-center my-32">
              <span className="loading loading-spinner loading-lg"></span>
            </div>
          }
        >
          {children}
        </Suspense>
        <Toaster position="bottom-right" />
      </div>
    </div>
  );
}

export function AppModal({
  children,
  title,
  buttonLabel,
  buttonClassName,
  submit,
  submitDisabled,
  submitLabel,
}: {
  children: ReactNode;
  title: string;
  buttonLabel?: ReactNode;
  buttonClassName?: string;
  submit?: () => boolean | Promise<boolean>;
  submitDisabled?: boolean;
  submitLabel?: string;
}) {
  const [show, setShow] = useState(false);
  const hide = useCallback(() => setShow(false), []);
  const onSubmit = useMemo(
    () =>
      submit
        ? async () => {
            let result = await submit();
            if (result) {
              hide();
            }
          }
        : hide(),
    [submit]
  );
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    if (!dialogRef.current) return;
    if (show) {
      dialogRef.current.showModal();
    } else {
      dialogRef.current.close();
    }
  }, [show, dialogRef]);

  return (
    <>
      <button
        className={`btn ${buttonClassName}`}
        onClick={() => setShow(true)}
      >
        {buttonLabel || title}
      </button>
      <dialog className="modal" ref={dialogRef}>
        <div className="modal-box space-y-5">
          <h3 className="font-bold text-lg">{title}</h3>
          {children}
          <div className="modal-action">
            <div className="join space-x-2">
              {onSubmit ? (
                <button
                  className="btn btn-md btn-primary"
                  onClick={onSubmit}
                  disabled={submitDisabled}
                >
                  {submitLabel || 'Save'}
                </button>
              ) : null}
              <button onClick={hide} className="btn btn-md">
                Close
              </button>
            </div>
          </div>
        </div>
      </dialog>
    </>
  );
}

export function AppHero({
  children,
  title,
  subtitle,
  HelpModal,
}: {
  children?: ReactNode;
  title: ReactNode;
  subtitle: ReactNode;
  HelpModal?: React.FC<{}>;
}) {
  return (
    <div className="hero py-8">
      <div className="hero-content p-0 text-center">
        <div>
          <div className="inline-flex items-center gap-4">
            {typeof title === 'string' ? (
              <h1 className="text-4xl font-bold">{title}</h1>
            ) : (
              title
            )}
            {HelpModal && <HelpModal />}
          </div>
          {typeof subtitle === 'string' ? (
            <p className="py-4">{subtitle}</p>
          ) : (
            subtitle
          )}
          {children}
        </div>
      </div>
    </div>
  );
}

export function ellipsify(str = '', len = 4) {
  if (str.length > 30) {
    return (
      str.substring(0, len) + '..' + str.substring(str.length - len, str.length)
    );
  }
  return str;
}

type TransactionToastStatus = 'sent' | 'confirmed';
const toastMessages: Record<TransactionToastStatus, string> = {
  sent: 'Sending transaction',
  confirmed: 'Transaction confirmed',
};
const signatureToasts: Record<string, string> = {};
export function useTransactionToast() {
  return (signature: string, status: 'sent' | 'confirmed') => {
    toast.dismiss(signatureToasts[signature]);
    const method = status === 'confirmed' ? toast.success : toast.loading;
    signatureToasts[signature] = method(
      <div className={'text-center'}>
        <div className="text-lg">{toastMessages[status]}</div>
        {status === 'confirmed' && (
          <ExplorerLink
            path={`tx/${signature}`}
            label={'View Transaction'}
            className="btn btn-xs btn-primary"
          />
        )}
      </div>,
      status === 'confirmed' ? { duration: 3000 } : undefined
    );
  };
}
