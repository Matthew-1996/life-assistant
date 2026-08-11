import { useEffect, useState } from "react";

import { ApiError } from "../api/client";
import {
  clearEncryptedDraft,
  loadEncryptedDraft,
  saveEncryptedDraft,
} from "../lib/draft-storage";

type WritableState = "draft" | "saving" | "success" | "conflict" | "failed";

export function useWritableForm<T extends object>(
  storageKey: string,
  initialValue: T,
) {
  const [draft, setDraft] = useState(initialValue);
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<WritableState>("draft");
  const [revision, setRevision] = useState<number | null>(null);
  const [conflict, setConflict] = useState<unknown>(null);

  useEffect(() => {
    let active = true;
    void loadEncryptedDraft<T>(storageKey).then((stored) => {
      if (!active) return;
      if (stored) setDraft(stored);
      setReady(true);
    });
    return () => {
      active = false;
    };
  }, [storageKey]);

  useEffect(() => {
    if (!ready) return;
    void saveEncryptedDraft(storageKey, draft);
  }, [draft, ready, storageKey]);

  function update(patch: Partial<T>) {
    setDraft((current) => ({ ...current, ...patch }));
    setState("draft");
    setConflict(null);
  }

  async function submit(
    operation: (value: T) => Promise<{ revision?: number }>,
  ): Promise<boolean> {
    setState("saving");
    try {
      const result = await operation(draft);
      setRevision(result.revision ?? null);
      setState("success");
      clearEncryptedDraft(storageKey);
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setConflict(error.response.error);
        setState("conflict");
      } else {
        setState("failed");
      }
      return false;
    }
  }

  return {
    conflict,
    draft,
    ready,
    revision,
    state,
    submit,
    update,
  };
}
