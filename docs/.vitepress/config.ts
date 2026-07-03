import { defineConfig } from "vitepress";

const repo = "https://github.com/getclarvis/agent-tools";
const site = "https://agent-tools.clarvis.dev";

const description =
  "A minimal, opinionated set of coding tools — read/search/edit/patch/bash/monitor — for driving an LLM agent over a workspace. Transport-agnostic, embeddable as a plain library.";

// Shared sidebar groups — referenced from every per-section sidebar so the mode-agnostic pages
// (reference, concepts, operations) live as single files but appear in each sidebar.
const guideGroup = {
  text: "Guide",
  collapsed: false,
  items: [
    { text: "Overview", link: "/guide/" },
    { text: "Embed in an agent loop", link: "/guide/embed-in-an-agent" },
    { text: "The core API", link: "/guide/the-core-api" },
    { text: "Read-only mode", link: "/guide/read-only-mode" },
    { text: "Limits & spill", link: "/guide/limits-and-spill" },
  ],
};

const referenceGroup = {
  text: "Reference",
  collapsed: false,
  items: [
    { text: "createAgentTools", link: "/reference/create-agent-tools" },
    { text: "Configuration", link: "/reference/configuration" },
    { text: "The tools", link: "/reference/tools" },
    { text: "Core API", link: "/reference/core-api" },
    { text: "Error codes", link: "/reference/error-codes" },
  ],
};

const conceptsGroup = {
  text: "Concepts",
  collapsed: false,
  items: [
    { text: "How it works", link: "/explanation/how-it-works" },
    { text: "Workspace confinement", link: "/explanation/confinement" },
    { text: "Text & encoding", link: "/explanation/text-and-encoding" },
  ],
};

const operationsGroup = {
  text: "Operations & security",
  collapsed: false,
  items: [{ text: "Deploy securely", link: "/operations/deploy-securely" }],
};

const startedGroup = {
  text: "Getting started",
  collapsed: false,
  items: [{ text: "Getting started", link: "/getting-started" }],
};

const sidebar = [startedGroup, guideGroup, referenceGroup, conceptsGroup, operationsGroup];

export default defineConfig({
  lang: "en-US",
  title: "@clarvis/agent-tools",
  description,

  // Served at the root of the agent-tools.clarvis.dev subdomain.
  // If you ever preview on a GitHub project path (user.github.io/agent-tools/),
  // change this to "/agent-tools/".
  base: "/",

  cleanUrls: true,
  lastUpdated: true,
  ignoreDeadLinks: false,

  // docs/README.md (if present) stays as the GitHub folder index; the site home is docs/index.md.
  // _partials/ holds @include fragments shared across pages — never built as standalone pages.
  srcExclude: ["README.md", "**/_partials/**"],

  sitemap: { hostname: site },

  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" }],
    ["meta", { name: "theme-color", content: "#5b54e8" }],
    ["meta", { name: "author", content: "Clarvis" }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:site_name", content: "@clarvis/agent-tools" }],
    ["meta", { property: "og:title", content: "@clarvis/agent-tools" }],
    ["meta", { property: "og:description", content: description }],
    ["meta", { property: "og:url", content: `${site}/` }],
    ["meta", { property: "og:image", content: `${site}/og.svg` }],
    ["meta", { name: "twitter:card", content: "summary_large_image" }],
    ["meta", { name: "twitter:title", content: "@clarvis/agent-tools" }],
    ["meta", { name: "twitter:description", content: description }],
    ["meta", { name: "twitter:image", content: `${site}/og.svg` }],
  ],

  themeConfig: {
    logo: { src: "/logo.svg", alt: "@clarvis/agent-tools" },
    siteTitle: "@clarvis/agent-tools",

    nav: [
      { text: "Guide", link: "/guide/", activeMatch: "/guide/" },
      { text: "Reference", activeMatch: "/reference/", items: referenceGroup.items },
      { text: "Concepts", activeMatch: "/explanation/", items: conceptsGroup.items },
      { text: "Operations", link: "/operations/deploy-securely", activeMatch: "/operations/" },
      {
        text: "v0.1.0",
        items: [
          { text: "npm", link: "https://www.npmjs.com/package/@clarvis/agent-tools" },
          { text: "SPEC.md", link: `${repo}/blob/main/SPEC.md` },
          { text: "License", link: `${repo}/blob/main/LICENSE` },
        ],
      },
      { text: "clarvis.dev", link: "https://clarvis.dev" },
    ],

    sidebar: {
      "/": sidebar,
    },

    outline: { level: [2, 3], label: "On this page" },

    search: { provider: "local" },

    socialLinks: [
      { icon: "github", link: repo },
      { icon: "npm", link: "https://www.npmjs.com/package/@clarvis/agent-tools" },
    ],

    editLink: {
      pattern: `${repo}/edit/main/docs/:path`,
      text: "Edit this page on GitHub",
    },

    lastUpdated: {
      text: "Last updated",
      formatOptions: { dateStyle: "medium" },
    },

    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright © 2026 Clarvis",
    },
  },
});
