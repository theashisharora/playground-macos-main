export interface BearMdData {
  id: string;
  title: string;
  /** Markdown file to render. Omit for pages registered as React components in Bear.tsx. */
  file?: string;
  icon: string;
  excerpt: string;
  link?: string;
}

export interface BearData {
  id: string;
  title: string;
  icon: string;
  md: BearMdData[];
}
