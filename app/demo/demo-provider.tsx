"use client";

import { createFlagsmithInstance } from "@flagsmith/flagsmith";
import { FlagsmithProvider } from "@flagsmith/flagsmith/react";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

const STORAGE_KEY = "verdict-demo-visitor";
const CHANGE_EVENT = "verdict-visitor";
// Client-side environment keys are public by design (they ship in browser SDKs).
const ENV_KEY = process.env.NEXT_PUBLIC_FLAGSMITH_ENVIRONMENT_KEY;

interface DemoContextValue {
  visitorId: string;
  /** Become a brand new visitor (new identity, new exposure). */
  resetVisitor: () => void;
}

const DemoContext = createContext<DemoContextValue | null>(null);

export function useDemo(): DemoContextValue {
  const v = useContext(DemoContext);
  if (!v) throw new Error("useDemo must be used inside <DemoProvider>");
  return v;
}

// "web-" marks real browser visitors; simulated traffic uses "sim-".
const freshId = () => `web-${crypto.randomUUID()}`;

function storeNewVisitor() {
  window.localStorage.setItem(STORAGE_KEY, freshId());
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

// localStorage does not exist during server rendering, so it is read through
// useSyncExternalStore: the server snapshot is null, the browser reads storage.
function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}
const readVisitor = () => window.localStorage.getItem(STORAGE_KEY);

export function DemoProvider({ children }: { children: ReactNode }) {
  const visitorId = useSyncExternalStore(subscribe, readVisitor, () => null);

  // First visit: mint an identity. Re-check storage so a double-invoked effect
  // (React strict mode) cannot create two identities.
  useEffect(() => {
    if (!window.localStorage.getItem(STORAGE_KEY)) storeNewVisitor();
  }, []);

  if (!ENV_KEY) {
    return (
      <p className="notice" role="alert">
        Set NEXT_PUBLIC_FLAGSMITH_ENVIRONMENT_KEY in .env.local and restart the dev server.
      </p>
    );
  }
  if (!visitorId) return <p className="muted">Loading…</p>;

  return (
    <DemoContext.Provider value={{ visitorId, resetVisitor: storeNewVisitor }}>
      {/* Keyed by visitor: a new visitor remounts this, which creates a fresh SDK instance. */}
      <VisitorScope key={visitorId} environmentId={ENV_KEY} visitorId={visitorId}>
        {children}
      </VisitorScope>
    </DemoContext.Provider>
  );
}

function VisitorScope({
  environmentId,
  visitorId,
  children,
}: {
  environmentId: string;
  visitorId: string;
  children: ReactNode;
}) {
  const [flagsmith] = useState(() => createFlagsmithInstance());
  return (
    <FlagsmithProvider
      flagsmith={flagsmith}
      options={{ environmentID: environmentId, identity: visitorId, enableEvents: true }}
    >
      {children}
    </FlagsmithProvider>
  );
}
