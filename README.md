# Ashish Arora — macOS Portfolio

My interactive portfolio, presented as a macOS-style desktop. Open the apps in the Dock to read about me, browse my projects, or try the Terminal.

- Website: [ashisharora.site](https://www.ashisharora.site/)
- GitHub: [@theashisharora](https://github.com/theashisharora)
- LinkedIn: [theashisharora2314](https://www.linkedin.com/in/theashisharora2314/)

Powered by [React](https://react.dev/) + [Zustand](https://zustand-demo.pmnd.rs/) + [UnoCSS](https://unocss.dev/) + [TypeScript](https://www.typescriptlang.org/) + [Vite](https://vitejs.dev/).

&nbsp;

## Usage

Install dependencies:

```bash
pnpm install
```

Start the dev server (with hot reloading):

```bash
pnpm dev
```

Build for production into the `dist` folder:

```bash
pnpm build
```

## Small-screen routing

Initial viewports narrower than 768 CSS pixels go to the independent classic
portfolio at `https://ashisharora.vercel.app/` before the login screen mounts.
Set `VITE_CLASSIC_PORTFOLIO_URL` to configure that destination. Invalid, non-HTTPS,
and same-origin destinations leave visitors on the macOS portfolio.

Use `?desktop=1` to keep the macOS experience for the current tab's browser
session, including refreshes and subsequent visits without the query parameter.
Resizing or rotating an already loaded page never triggers a redirect. Width is
measured in CSS pixels: 768px tablets and wider phone landscape viewports stay
on macOS; narrow desktop windows and zoomed initial viewports below 768px use
classic unless overridden. No device or user-agent sniffing is involved.

## Local regression checks

Run the redirect tests with Node 22 or later:

```bash
node --experimental-strip-types --test tests/mobileRedirect.test.ts
```

After `pnpm build`, start `pnpm serve --port 4173` and run
`node tests/portfolio.browser.mjs` with Playwright and Chrome available. The
`PLAYWRIGHT_MODULE` environment variable can point to the file URL of an existing
Playwright `index.mjs`, allowing temporary tooling outside the project without
changing application dependencies. `PORTFOLIO_TEST_URL` overrides the local URL.
Set `PORTFOLIO_CHECK_PUBLIC=1` to also check the real classic portfolio; other
external navigation is stubbed so the regression suite does not exercise other
projects. Screenshots are saved to the ignored `.cache/` directory.

## Personalizing

| What | Where |
| --- | --- |
| Name / avatar | `src/configs/user.ts`, `public/img/ui/avatar.jpg` |
| Wallpapers | `src/configs/wallpapers.ts`, `public/img/ui/wallpaper-{day,night}.jpg` |
| About me & projects (Bear app) | `public/markdown/`, `src/configs/bear.tsx` |
| Safari links | `src/configs/websites.ts` |
| Launchpad | `src/configs/launchpad.ts` |
| Terminal | `src/configs/terminal.tsx` |

In the markdown files, wrap a keyword in `<span class="accent">…</span>` to highlight it in red. The `.accent` class lives in `src/styles/component.css`.

&nbsp;

## Credits

- Based on the open-source [playground-macos](https://github.com/Renovamen/playground-macos) template by Xiaohan Zou (MIT License, see [LICENSE](./LICENSE)).
- macOS [Monterey](https://www.apple.com/macos/monterey/) and [Catalina](https://www.apple.com/bw/macos/catalina/)
- [macOS Icon Gallery](https://www.macosicongallery.com/)
- [sindresorhus/file-icon-cli](https://github.com/sindresorhus/file-icon-cli)
- [vivek9patel.github.io](https://github.com/vivek9patel/vivek9patel.github.io)
