export function LoadingSpinner({ label = "載入中…" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-muted">
      <span
        className="h-8 w-8 animate-spin rounded-full border-2 border-accent/30 border-t-accent"
        aria-hidden
      />
      <span className="text-sm">{label}</span>
    </div>
  );
}
