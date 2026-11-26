import type { TerminalData } from "~/types";

const link = "text-blue-300 hover:underline";

const terminal: TerminalData[] = [
  {
    id: "about",
    title: "about",
    type: "folder",
    children: [
      {
        id: "about-bio",
        title: "bio.txt",
        type: "file",
        content: (
          <div className="py-1">
            <div>
              Hi, I&apos;m <span className="accent">Ashish Arora</span>, a{" "}
              <span className="accent">full-stack developer</span> and Junior Software
              Developer at Naryant. I study Computer Systems Technology at Sheridan
              College, and I build web apps with React, Next.js and C# / .NET.
            </div>
          </div>
        )
      },
      {
        id: "about-interests",
        title: "interests.txt",
        type: "file",
        content:
          "Full-Stack Development / AI-Assisted Applications / Secure Software / System Architecture"
      },
      {
        id: "about-skills",
        title: "skills.txt",
        type: "file",
        content: (
          <ul className="list-disc ml-6">
            <li>Languages: JavaScript, TypeScript, C#, Python, Java, SQL</li>
            <li>Frameworks: React, Next.js, Node.js, ASP.NET Core / .NET MVC</li>
            <li>Data: SQL Server, MySQL, MongoDB, Firebase</li>
            <li>Tools: Git, Docker, Azure, Vercel, Postman</li>
          </ul>
        )
      },
      {
        id: "about-contact",
        title: "contact.txt",
        type: "file",
        content: (
          <ul className="list-disc ml-6">
            <li>
              Email:{" "}
              <a className={link} href="mailto:arashish@sheridancollege.ca">
                arashish@sheridancollege.ca
              </a>
            </li>
            <li>
              Github:{" "}
              <a
                className={link}
                href="https://github.com/theashisharora"
                target="_blank"
                rel="noreferrer"
              >
                @theashisharora
              </a>
            </li>
            <li>
              Linkedin:{" "}
              <a
                className={link}
                href="https://www.linkedin.com/in/theashisharora2314/"
                target="_blank"
                rel="noreferrer"
              >
                theashisharora2314
              </a>
            </li>
            <li>
              Website:{" "}
              <a
                className={link}
                href="https://www.ashisharora.site/"
                target="_blank"
                rel="noreferrer"
              >
                ashisharora.site
              </a>
            </li>
          </ul>
        )
      }
    ]
  },
  {
    id: "projects",
    title: "projects",
    type: "folder",
    children: [
      {
        id: "projects-list",
        title: "highlights.txt",
        type: "file",
        content: (
          <ul className="list-disc ml-6">
            <li>
              <span className="accent">Sales Storyline</span>: AI sales insights from
              HubSpot + Google Drive
            </li>
            <li>
              <span className="accent">Functional Analyzer</span>: AI-assisted interview
              &amp; analysis platform
            </li>
            <li>
              <span className="accent">Vote4Ash</span>: real-time online voting (Next.js +
              Firebase)
            </li>
            <li>
              <span className="accent">Go2Gether</span>: BramHacks carpooling &amp;
              transit app
            </li>
          </ul>
        )
      }
    ]
  },
  {
    id: "about-motto",
    title: "motto.ts",
    type: "file",
    content: (
      <div className="py-1">
        <div>
          <span className="text-yellow-400">const</span>{" "}
          <span className="text-blue-400">ash</span> = (
          <span className="text-blue-400">name</span>,{" "}
          <span className="text-blue-400">passion</span>) <span>{"=>"}</span>{" "}
          <span className="text-green-300">&quot;Code that tells a story.&quot;</span>;
        </div>
      </div>
    )
  }
];

export default terminal;
