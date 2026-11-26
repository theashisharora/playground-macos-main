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
