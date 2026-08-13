import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  clearSessionDraft,
  hasActiveSessionDrafts,
  loadEncryptedDraft,
  markSessionDraftActive,
  saveEncryptedDraft,
  sessionDraftGeneration,
  subscribeSessionDraftActivity,
} from "../lib/draft-storage";

export interface SessionDraft<T> {
  clear(): void;
  persist(action: SetStateAction<T>): Promise<T>;
  ready: boolean;
  setValue: Dispatch<SetStateAction<T>>;
  value: T;
}

/**
 * Keeps an encrypted, tab-session-scoped draft. The ciphertext may remain in
 * localStorage while the page is unmounted, but its AES-GCM key and activity
 * index exist only in sessionStorage. Callers decide what counts as empty so
 * untouched forms never create a misleading unsaved-draft warning.
 */
export function useSessionDraft<T>(
  storageKey: string,
  initialValue: T,
  isEmpty: (value: T) => boolean,
): SessionDraft<T> {
  const initialValueRef = useRef(initialValue);
  const isEmptyRef = useRef(isEmpty);
  const writeQueue = useRef<Promise<void>>(Promise.resolve());
  const writeVersion = useRef(0);
  const [value, setValue] = useState<T>(initialValue);
  const valueRef = useRef(value);
  const [ready, setReady] = useState(false);

  isEmptyRef.current = isEmpty;

  useEffect(() => {
    let active = true;
    const lifecycleClearGeneration = sessionDraftGeneration(storageKey);
    const hydrationVersion = writeVersion.current;
    setReady(false);
    valueRef.current = initialValueRef.current;
    setValue(initialValueRef.current);
    let hydrationApplied = false;
    void loadEncryptedDraft<T>(storageKey).then((stored) => {
      if (!active) return;
      if (
        stored !== null
        && writeVersion.current === hydrationVersion
      ) {
        valueRef.current = stored;
        markSessionDraftActive(storageKey, !isEmptyRef.current(stored));
        setValue(stored);
        hydrationApplied = true;
      }
      else if (writeVersion.current === hydrationVersion) {
        clearSessionDraft(storageKey);
      }
      setReady(true);
    });
    return () => {
      active = false;
      if (!hydrationApplied && !isEmptyRef.current(valueRef.current)) {
        void saveEncryptedDraft(
          storageKey,
          valueRef.current,
          lifecycleClearGeneration,
        ).then((saved) => {
          if (
            saved
            && lifecycleClearGeneration === sessionDraftGeneration(storageKey)
          ) {
            markSessionDraftActive(storageKey, true);
          }
        });
      }
    };
  }, [storageKey]);

  useEffect(() => {
    if (!ready) return;
    const snapshot = value;
    const version = writeVersion.current;
    const clearGeneration = sessionDraftGeneration(storageKey);
    writeQueue.current = writeQueue.current.then(async () => {
      if (
        version !== writeVersion.current
        || clearGeneration !== sessionDraftGeneration(storageKey)
      ) return;
      if (isEmptyRef.current(snapshot)) {
        clearSessionDraft(storageKey);
        return;
      }
      const saved = await saveEncryptedDraft(
        storageKey,
        snapshot,
        clearGeneration,
      );
      if (
        saved
        &&
        version === writeVersion.current
        && clearGeneration === sessionDraftGeneration(storageKey)
      ) {
        markSessionDraftActive(storageKey, true);
      }
    });
  }, [ready, storageKey, value]);

  const updateValue: Dispatch<SetStateAction<T>> = useCallback((action) => {
    const next = typeof action === "function"
      ? (action as (current: T) => T)(valueRef.current)
      : action;
    valueRef.current = next;
    writeVersion.current += 1;
    markSessionDraftActive(storageKey, !isEmptyRef.current(next));
    setValue(next);
  }, [storageKey]);

  const clear = useCallback(() => {
    const emptyValue = initialValueRef.current;
    valueRef.current = emptyValue;
    writeVersion.current += 1;
    clearSessionDraft(storageKey);
    writeQueue.current = writeQueue.current.then(() => {
      clearSessionDraft(storageKey);
    });
    setValue(emptyValue);
  }, [storageKey]);

  const persist = useCallback(async (action: SetStateAction<T>) => {
    const next = typeof action === "function"
      ? (action as (current: T) => T)(valueRef.current)
      : action;
    valueRef.current = next;
    writeVersion.current += 1;
    const version = writeVersion.current;
    const clearGeneration = sessionDraftGeneration(storageKey);
    markSessionDraftActive(storageKey, !isEmptyRef.current(next));
    setValue(next);
    if (isEmptyRef.current(next)) {
      clearSessionDraft(storageKey);
      return next;
    }
    const saved = await saveEncryptedDraft(
      storageKey,
      next,
      clearGeneration,
    );
    if (
      saved
      &&
      version === writeVersion.current
      && clearGeneration === sessionDraftGeneration(storageKey)
    ) {
      markSessionDraftActive(storageKey, true);
    }
    return next;
  }, [storageKey]);

  return { clear, persist, ready, setValue: updateValue, value };
}

export function useHasActiveSessionDrafts(scope?: string): boolean {
  return useSyncExternalStore(
    subscribeSessionDraftActivity,
    () => hasActiveSessionDrafts(scope),
    () => false,
  );
}
