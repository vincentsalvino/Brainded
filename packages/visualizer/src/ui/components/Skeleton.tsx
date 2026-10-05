interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  className?: string;
}

export function Skeleton({ width, height, className }: SkeletonProps) {
  return <div className={`skeleton${className ? ` ${className}` : ""}`} style={{ width, height }} aria-hidden="true" />;
}

/** Stacked line placeholders for text/row content -- last line shorter, like real prose trailing off. */
export function SkeletonLines({ count, height = 14 }: { count: number; height?: number }) {
  return (
    <div className="skeleton-lines">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} height={height} width={i === count - 1 ? "60%" : "100%"} />
      ))}
    </div>
  );
}
