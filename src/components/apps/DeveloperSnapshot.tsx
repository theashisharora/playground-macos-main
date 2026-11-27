interface SkillGroup {
  label: string;
  items: string[];
}

interface Project {
  name: string;
  icon: string;
  tagline: string;
  summary: string;
  stack: string[];
  link?: string;
}

const skills: SkillGroup[] = [
  { label: "Frontend", items: ["React", "TypeScript", "JavaScript", "HTML", "CSS"] },
  { label: "Backend", items: ["ASP.NET Core", ".NET", "C#"] },
  { label: "Database", items: ["SQL Server", "SQL"] },
  { label: "Other", items: ["Git", "GitHub", "APIs", "Automation"] }
];

const builds: { label: string; icon: string }[] = [
  { label: "Full-stack web applications", icon: "i-ri:stack-line" },
  { label: "Client & partner portals", icon: "i-ri:door-open-line" },
  { label: "Internal business applications", icon: "i-ri:building-2-line" },
  { label: "Automation tools", icon: "i-ri:robot-2-line" },
  { label: "Interactive dashboards", icon: "i-ri:dashboard-3-line" }
];

// Descriptions mirror public/markdown/projects/*.md
const projects: Project[] = [
  {
    name: "Functional Analyzer",
    icon: "i-ri:survey-line",
    tagline: "AI-assisted interview & analysis platform",
    summary:
      "Lets administrators create, manage, and assign structured functional interviews, with response tracking and AI-assisted analysis and reporting.",
    stack: ["React", "JavaScript", "REST API", "Docker"]
  },
  {
    name: "Go2Gether",
    icon: "i-ri:car-line",
    tagline: "Carpooling & transit app · BramHacks",
    summary:
      "Connects people heading to similar destinations so they can share rides and cut travel costs, with real-time ride matching.",
    stack: ["HTML", "SCSS", "JavaScript", "Bootstrap", "APIs"],
    link: "https://theashisharora.github.io/go2gether/"
  },
  {
    name: "Vote4Ash",
    icon: "i-ri:checkbox-multiple-line",
    tagline: "Online voting platform",
    summary:
      "Secure, responsive voting for student organizations and community polls, with role-based access control and real-time results.",
    stack: ["Next.js", "React", "Tailwind CSS", "Firebase"],
    link: "https://vote4ash.vercel.app/"
  }
];

// Icons live in a lookup (not a JSX attribute) so UnoCSS attributify doesn't misparse them
const sectionIcons = {
  "Technical Skills": "i-ri:code-s-slash-line",
  "What I Build": "i-ri:hammer-line",
  "Featured Projects": "i-ri:star-line"
} as const;

const SectionTitle = ({ heading }: { heading: keyof typeof sectionIcons }) => (
  <h2 className="snap-title">
    <span className={`${sectionIcons[heading]} text-red-500 dark:text-red-400`} />
    {heading}
  </h2>
);

const DeveloperSnapshot = () => (
  <div className="snapshot">
    <header>
      <p className="snap-eyebrow">Developer Snapshot</p>
      <h1 className="text-2xl font-bold text-c-800">Ashish Arora</h1>
      <p className="mt-2 leading-relaxed">
        I'm a <span className="accent">software developer</span> who enjoys building
        practical applications and solving real-world problems, from clean interfaces to
        the back ends and data behind them.
      </p>
    </header>

    <div className="snap-facts">
      <div className="snap-card">
        <span className="snap-card-label">
          <span className="i-ri:briefcase-4-line" /> Current role
        </span>
        <span className="font-semibold text-c-800">Junior Software Developer</span>
        <span className="text-sm">
          at <span className="accent">Naryant</span>
        </span>
      </div>
      <div className="snap-card">
        <span className="snap-card-label">
          <span className="i-ri:graduation-cap-line" /> Education
        </span>
        <span className="font-semibold text-c-800">Computer Systems Engineering</span>
        <span className="text-sm">Sheridan College</span>
      </div>
    </div>

    <section>
      <SectionTitle heading="Technical Skills" />
      <div className="space-y-3">
        {skills.map((group) => (
          <div key={group.label} className="snap-skill-row">
            <span className="snap-skill-label">{group.label}</span>
            <div className="flex flex-wrap gap-1.5">
              {group.items.map((item) => (
                <span key={item} className="snap-badge">
                  {item}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>

    <section>
      <SectionTitle heading="What I Build" />
      <ul className="snap-builds">
        {builds.map((b) => (
          <li key={b.label}>
            <span className={`${b.icon} text-red-500 dark:text-red-400 shrink-0`} />
            {b.label}
          </li>
        ))}
      </ul>
    </section>

    <section>
      <SectionTitle heading="Featured Projects" />
      <div className="space-y-3">
        {projects.map((p) => (
          <article key={p.name} className="snap-card snap-project">
            <div className="hstack justify-between gap-2">
              <span className="hstack gap-2 font-semibold text-c-800">
                <span className={`${p.icon} text-red-500 dark:text-red-400`} />
                {p.name}
              </span>
              {p.link && (
                <a
                  href={p.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="snap-link"
                  aria-label={`Open ${p.name}`}
                >
                  Visit <span className="i-ri:arrow-right-up-line" />
                </a>
              )}
            </div>
            <span className="text-xs text-c-500">{p.tagline}</span>
            <p className="text-sm leading-relaxed">{p.summary}</p>
            <div className="flex flex-wrap gap-1.5">
              {p.stack.map((s) => (
                <span key={s} className="snap-badge snap-badge-sm">
                  {s}
                </span>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  </div>
);

export default DeveloperSnapshot;
