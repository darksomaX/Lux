// Search engines. The user picks one in settings; queries (input that isn't a
// URL) are sent to it. Order: Startpage, DuckDuckGo, Com (Google).

export const ENGINES = [
  {
    id: "startpage",
    label: "Startpage",
    search: (q) => "https://www.startpage.com/sp/search?query=" + encodeURIComponent(q),
    home: "https://www.startpage.com/",
  },
  {
    id: "duckduckgo",
    label: "DuckDuckGo",
    search: (q) => "https://duckduckgo.com/?q=" + encodeURIComponent(q),
    home: "https://duckduckgo.com/",
  },
  {
    id: "com",
    label: "Com (Google)",
    // udm=14 forces plain verbatim web results, skipping the AI overview and
    // the extra redirects. This is the cleanest Google search URL.
    search: (q) => "https://www.google.com/search?udm=14&q=" + encodeURIComponent(q),
    home: "https://www.google.com/",
  },
  {
    id: "brave",
    label: "Brave",
    search: (q) => "https://search.brave.com/search?q=" + encodeURIComponent(q),
    home: "https://search.brave.com/",
  },
  {
    id: "bing",
    label: "Bing",
    search: (q) => "https://www.bing.com/search?q=" + encodeURIComponent(q),
    home: "https://www.bing.com/",
  },
];

const byId = Object.fromEntries(ENGINES.map((e) => [e.id, e]));

export function getEngine(id) {
  return byId[id] || ENGINES[0];
}

export function listEngines() {
  return ENGINES.map((e) => ({ id: e.id, label: e.label }));
}
