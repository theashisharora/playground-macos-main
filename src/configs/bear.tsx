import type { BearData } from "~/types";

const bear: BearData[] = [
  {
    id: "profile",
    title: "Profile",
    icon: "i-fa-solid:spider",
    md: [
      {
        id: "about-me",
        title: "About Me",
        file: "markdown/about-me.md",
        icon: "i-fa-solid:user-astronaut",
        excerpt:
          "Hey, I'm Ashish, a full-stack developer who builds software that tells a story..."
      },
      {
        id: "github-stats",
        title: "Github Stats",
        file: "markdown/github-stats.md",
        icon: "i-icon-park-outline:github",
        excerpt: "A quick look at my GitHub activity and top languages..."
      },
      {
        id: "about-site",
        title: "About This Site",
        file: "markdown/about-site.md",
        icon: "i-octicon:browser",
        excerpt: "How this macOS-style portfolio was built..."
      }
    ]
  },
  {
    id: "project",
    title: "Projects",
    icon: "i-octicon:repo",
    md: [
      {
        id: "sales-storyline",
        title: "Sales Storyline",
        file: "markdown/projects/sales-storyline.md",
        icon: "i-ri:line-chart-line",
        excerpt: "AI sales intelligence built on HubSpot, Google Drive and OpenAI..."
      },
      {
        id: "functional-analyzer",
        title: "Functional Analyzer",
        file: "markdown/projects/functional-analyzer.md",
        icon: "i-ri:survey-line",
        excerpt: "AI-assisted interview and analysis platform..."
      },
      {
        id: "vote4ash",
        title: "Vote4Ash",
        file: "markdown/projects/vote4ash.md",
        icon: "i-ri:checkbox-multiple-line",
        excerpt: "Secure, real-time online voting for student organizations...",
        link: "https://vote4ash.vercel.app/"
      },
      {
        id: "go2gether",
        title: "Go2Gether",
        file: "markdown/projects/go2gether.md",
        icon: "i-ri:car-line",
        excerpt: "BramHacks carpooling and transit app with ride matching...",
        link: "https://theashisharora.github.io/go2gether/"
      },
      {
        id: "portfolio",
        title: "Portfolio Website",
        file: "markdown/projects/portfolio.md",
        icon: "i-ri:global-line",
        excerpt: "My personal brand site at ashisharora.site...",
        link: "https://www.ashisharora.site/"
      }
    ]
  }
];

export default bear;
