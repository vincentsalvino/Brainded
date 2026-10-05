interface EmptyStateProps {
  message: string;
  tone?: "empty" | "error";
}

export function EmptyState({ message, tone = "empty" }: EmptyStateProps) {
  return <div className={`empty-state${tone === "error" ? " empty-state-error" : ""}`}>{message}</div>;
}
