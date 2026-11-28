// Public frontend configuration. Keep the classic and macOS projects separate.
export const classicPortfolioUrl =
  import.meta.env.VITE_CLASSIC_PORTFOLIO_URL || "https://ashisharora.vercel.app/";

// 768px tablets retain the desktop experience; narrower initial viewports use classic.
export const desktopMinWidth = 768;
