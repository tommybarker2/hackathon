export interface ExampleRepo {
  id: string;
  name: string;
  owner: string;
  kind: "local" | "github";
  localPath?: string;
  url?: string;
  lang: string;
  accent: string;
  blurb: string;
}

/**
 * Baked-in examples. Kept deliberately small: the demo should finish importing
 * while the judge is still reading the card, and every entry must be a real,
 * public repository whose map is interesting on the first screen.
 */
export const EXAMPLES: ExampleRepo[] = [
  {
    id: "this-app",
    name: "repo_cloud",
    owner: "local worktree",
    kind: "local",
    localPath: ".",
    lang: "TypeScript",
    accent: "--yellow",
    blurb:
      "The Repo Cloud itself: React views, a Hono API and the parser that built this map.",
  },
  {
    id: "hono",
    name: "Hono",
    owner: "honojs/hono",
    kind: "github",
    url: "https://github.com/honojs/hono",
    lang: "TypeScript",
    accent: "--mint",
    blurb: "Ultrafast web framework built on Web Standards, with a dense and tidy import graph.",
  },
  {
    id: "express",
    name: "Express",
    owner: "expressjs/express",
    kind: "github",
    url: "https://github.com/expressjs/express",
    lang: "JavaScript",
    accent: "--salmon",
    blurb: "The classic Node HTTP framework: familiar middleware and a small, readable core.",
  },
  {
    id: "flask",
    name: "Flask",
    owner: "pallets/flask",
    kind: "github",
    url: "https://github.com/pallets/flask",
    lang: "Python",
    accent: "--blue",
    blurb: "Python microframework with blueprints, routing and request handling in a compact tree.",
  },
  {
    id: "requests",
    name: "Requests",
    owner: "psf/requests",
    kind: "github",
    url: "https://github.com/psf/requests",
    lang: "Python",
    accent: "--lilac",
    blurb: "Python HTTP client whose sessions, adapters and auth make a tidy dependency map.",
  },
  {
    id: "chalk",
    name: "Chalk",
    owner: "chalk/chalk",
    kind: "github",
    url: "https://github.com/chalk/chalk",
    lang: "JavaScript",
    accent: "--mint",
    blurb: "Terminal string styling with almost no surface area — the fastest first import.",
  },
];
