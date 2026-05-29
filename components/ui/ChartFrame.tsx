/** 圖表外層：固定響應式高度，供 Recharts ResponsiveContainer 使用 */
export function ChartFrame({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`h-[220px] w-full min-w-0 sm:h-[260px] md:h-[300px] ${className}`}
    >
      {children}
    </div>
  );
}
