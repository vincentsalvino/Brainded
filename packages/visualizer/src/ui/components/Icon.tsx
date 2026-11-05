import type { SVGProps } from "react";

const paths = {
  atlas: "M3 5.5 7.5 3l5 2.5L17 3v11.5L12.5 17l-5-2.5L3 17V5.5ZM7.5 3v11.5m5-9V17",
  network: "M10 7v4m-5 3v-1a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1M12 5a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM7 16a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm10 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z",
  layers: "m10 3 7 4-7 4-7-4 7-4Zm-7 7 7 4 7-4M3 13l7 4 7-4",
  chart: "M3 3v14h14M7 13v-3m4 3V6m4 7V4",
  search: "M12.5 12.5 17 17m-3-8.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0Z",
  arrow: "M3 10h13m-5-5 5 5-5 5",
  close: "m5 5 10 10M15 5 5 15",
  panel: "M3 4h14v12H3zM12 4v12",
  filter: "M3 5h14M6 10h8m-5 5h2",
  eye: "M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5Zm10 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z",
  file: "M5 3h7l3 3v11H5zM8 9h4m-4 4h4",
  link: "m8 12 4-4m-5 6-1 1a2.8 2.8 0 1 1-4-4l3-3a2.8 2.8 0 0 1 4 0m4-2 1-1a2.8 2.8 0 1 1 4 4l-3 3a2.8 2.8 0 0 1-4 0",
  pulse: "M2 10h4l2-5 3 10 2-5h5",
  database: "M3 6a7 3 0 1 0 14 0A7 3 0 1 0 3 6Zm0 0v8a7 3 0 0 0 14 0V6M3 10a7 3 0 0 0 14 0",
  fit: "M3 7V3h4m6 0h4v4m0 6v4h-4m-6 0H3v-4",
  plus: "M4 10h12m-6-6v12",
  minus: "M4 10h12",
  chevronLeft: "m12 5-5 5 5 5",
  chevronRight: "m8 5 5 5-5 5",
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, ...props }: { name: IconName } & Pick<SVGProps<SVGSVGElement>, "className">) {
  return (
    <svg {...props} width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={paths[name]} />
    </svg>
  );
}
