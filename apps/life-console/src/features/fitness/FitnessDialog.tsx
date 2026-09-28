import { useEffect, useRef, type ReactNode } from "react";
export function FitnessDialog({
  label,
  busy,
  onClose,
  children,
}: {
  label: string;
  busy: boolean;
  onClose(): void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = ref.current!;
    dialog.showModal();
    dialog.querySelector<HTMLElement>("[data-initial-focus]")?.focus();
    return () => {
      dialog.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, []);
  return (
    <dialog
      aria-label={label}
      className="fitness-dialog"
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      {children}
    </dialog>
  );
}
