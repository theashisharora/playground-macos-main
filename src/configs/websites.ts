import type { WebsitesData } from "~/types";

const websites: WebsitesData = {
  favorites: {
    title: "Ashish's Links",
    sites: [
      {
        id: "my-portfolio",
        title: "Portfolio",
        img: "img/ui/avatar.jpg",
        link: "https://www.ashisharora.site/"
      },
      {
        id: "my-github",
        title: "Github",
        img: "img/sites/github.svg",
        link: "https://github.com/theashisharora"
      },
      {
        id: "my-linkedin",
        title: "Linkedin",
        img: "img/sites/linkedin.svg",
        link: "https://www.linkedin.com/in/theashisharora2314/"
      },
      {
        id: "my-email",
        title: "Email",
        img: "img/sites/gmail.svg",
        link: "mailto:arashish@sheridancollege.ca"
      },
      {
        id: "my-resume",
        title: "Résumé",
        img: "img/icons/launchpad/ashish-resume.svg",
        link: "files/Ashish_Arora_Resume.pdf"
      },
      {
        id: "my-vote4ash",
        title: "Vote4Ash",
        img: "img/icons/launchpad/vote4ash.svg",
        link: "https://vote4ash.vercel.app/"
      },
      {
        id: "my-go2gether",
        title: "Go2Gether",
        img: "img/icons/launchpad/go2gether.svg",
        link: "https://theashisharora.github.io/go2gether/"
      }
    ]
  },
  freq: {
    title: "Frequently Visited",
    sites: [
      {
        id: "github",
        title: "Github",
        img: "img/sites/github.svg",
        link: "https://github.com/"
      },
      {
        id: "leetcode",
        title: "LeetCode",
        img: "img/sites/leetcode.svg",
        link: "https://leetcode.com/"
      },
      {
        id: "mdn",
        title: "MDN",
        link: "https://developer.mozilla.org/"
      },
      {
        id: "react",
        title: "React",
        link: "https://react.dev/"
      },
      {
        id: "ms-learn",
        title: ".NET Docs",
        link: "https://learn.microsoft.com/dotnet/"
      },
      {
        id: "vercel",
        title: "Vercel",
        link: "https://vercel.com/"
      },
      {
        id: "hacker-news",
        title: "Hacker News",
        img: "img/sites/hacker.svg",
        link: "https://news.ycombinator.com/"
      },
      {
        id: "reddit",
        title: "Reddit",
        img: "img/sites/reddit.svg",
        link: "https://www.reddit.com/"
      },
      {
        id: "dribbble",
        title: "Dribbble",
        img: "img/sites/dribbble.svg",
        link: "https://dribbble.com/"
      }
    ]
  }
};

export default websites;
