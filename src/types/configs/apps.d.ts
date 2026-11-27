export interface AppsData {
  id: string;
  title: string;
  desktop: boolean;
  img: string;
  show?: boolean;
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
  aspectRatio?: number;
  x?: number;
  y?: number;
  content?: JSX.Element;
  link?: string;
  /** Also show this desktop app in Launchpad (opens the window). */
  launchpad?: boolean;
}
