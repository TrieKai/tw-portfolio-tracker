"use client";

import { type ReactNode, useLayoutEffect, useRef } from "react";

export function Modal({
  children,
  labelledBy,
  onClose,
  dismissOnBackdrop = false,
  placement = "center",
}: {
  children: ReactNode;
  labelledBy: string;
  onClose?: () => void;
  dismissOnBackdrop?: boolean;
  placement?: "center" | "side";
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={labelledBy}
      className={`modal-layer items-end ${
        placement === "side" ? "sm:items-stretch sm:justify-end" : "justify-center sm:items-center sm:p-4"
      }`}
      onCancel={(event) => {
        event.preventDefault();
        onClose?.();
      }}
      onClick={(event) => {
        if (dismissOnBackdrop && event.target === event.currentTarget) onClose?.();
      }}
    >
      {children}
    </dialog>
  );
}
