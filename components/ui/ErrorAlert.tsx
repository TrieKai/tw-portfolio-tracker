export function ErrorAlert({
  title,
  message,
  onDismiss,
}: {
  title?: string;
  message: string;
  onDismiss?: () => void;
}) {
  return (
    <div
      className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-rose-700 dark:text-rose-300"
      role="alert"
    >
      {title && <p className="font-medium">{title}</p>}
      <p className={title ? "mt-1 text-sm opacity-90" : "text-sm"}>{message}</p>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="mt-2 text-xs underline opacity-70 hover:opacity-100"
        >
          關閉
        </button>
      )}
    </div>
  );
}
