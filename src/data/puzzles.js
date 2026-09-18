// Puzzle data for Patchboard.
//
// Every problem is one self-contained object, so new puzzles can be added here
// without touching evaluator, canvas, or UI logic.
//
// Authoring rules (from the PRD):
//   - `ids` in a requirement is a list of acceptable alternates; ANY one
//     satisfies it. This is what lets two valid architectures both score well.
//   - `requiredConnections` are checked by type (not by block instance) and are
//     direction-agnostic (either order of from/to counts as a match).
//   - The FIRST id in each ids/from/to list is canonical: it is what
//     "Solve for me" places and wires. Keep first alternates consistent across a
//     problem's requirements and connections, or auto-solve will build a set of
//     components that were never meant to connect to each other.
//   - Exactly 3 hints per puzzle, ordered most conceptual -> most specific.
//   - Requirement `label` text is read standalone by learners (it is reused
//     verbatim in the evaluation checklist and the Solve-for-me explanation), so
//     write each label as a complete, plain-language sentence.

export const PUZZLES = [
  {
    id: 'url-shortener',
    title: 'Design a URL Shortener',
    desc:
      'Build a service that turns long URLs into short codes and redirects users when they visit a short link. Expect far more redirects (reads) than new links (writes).',
    requirements: [
      'Turn a long URL into a unique short code and store the mapping.',
      'Redirect a short code back to its original URL quickly.',
      'Handle heavy, read-dominated traffic without overloading storage.',
      'Scale horizontally so no single server is a bottleneck.',
    ],
    hints: [
      'This system is read-heavy: far more redirects than new links. Design for the reads first.',
      'Generating and storing a unique short code is the write path; looking it up fast is the read path. Separate them in your head.',
      'Put a cache in front of the database so hot short links do not hit storage on every redirect.',
    ],
    requiredComponents: [
      { ids: ['lb'], min: 1, label: 'A load balancer to spread incoming traffic across multiple servers.' },
      {
        ids: ['webserver', 'gateway', 'microservice'],
        min: 1,
        label: 'A service that handles both shortening and redirect requests.',
      },
      {
        ids: ['sql', 'nosql'],
        min: 1,
        label: 'A database that stores the short-code-to-URL mapping durably.',
      },
      { ids: ['cache'], min: 1, label: 'A cache that serves hot short links without touching the database.' },
    ],
    requiredConnections: [
      { from: ['client'], to: ['lb', 'gateway', 'webserver'], label: 'The client reaches an entry point.' },
      {
        from: ['lb'],
        to: ['webserver', 'gateway', 'microservice'],
        label: 'The load balancer forwards requests to the service.',
      },
      {
        from: ['webserver', 'gateway', 'microservice'],
        to: ['cache'],
        label: 'The service checks the cache before falling back to the database.',
      },
      {
        from: ['webserver', 'gateway', 'microservice'],
        to: ['sql', 'nosql'],
        label: 'The service reads and writes the mapping in the database.',
      },
    ],
  },

  {
    id: 'rate-limiter',
    title: 'Design a Distributed Rate Limiter',
    desc:
      'Cap how many requests each user or API key can make within a time window, enforced consistently across a whole fleet of servers rather than per machine.',
    requirements: [
      'Enforce a per-client request limit at the edge, before work is done.',
      'Share the request count across every server so the limit is global, not per-instance.',
      'Increment counters and decide allow-or-deny fast enough to sit in the hot path.',
      'Forward only allowed requests to the backend service.',
    ],
    hints: [
      'Where you enforce the limit matters: doing it at the edge protects everything behind it.',
      "A single server's local counter will not work across a fleet; the count has to live somewhere shared.",
      'Use a fast in-memory store (Redis-like) for atomic increments with a TTL per window.',
    ],
    requiredComponents: [
      {
        ids: ['gateway', 'lb'],
        min: 1,
        label: 'An edge component (API gateway or load balancer) where limiting is enforced.',
      },
      {
        ids: ['webserver', 'microservice'],
        min: 1,
        label: 'A backend service that handles requests once they are allowed through.',
      },
      {
        ids: ['cache'],
        min: 1,
        label: 'A shared in-memory store (Redis-like) holding per-client counters.',
      },
    ],
    requiredConnections: [
      { from: ['client'], to: ['gateway', 'lb'], label: 'The client sends requests to the edge.' },
      {
        from: ['gateway', 'lb'],
        to: ['cache'],
        label: 'The edge checks and increments the shared counter to decide allow or deny.',
      },
      {
        from: ['gateway', 'lb'],
        to: ['webserver', 'microservice'],
        label: 'Allowed requests are forwarded to the backend service.',
      },
    ],
  },

  {
    id: 'chat-backend',
    title: 'Design a Real-Time Chat Backend',
    desc:
      'Support real-time messaging between users held on long-lived connections, deliver messages to recipients on any server, and keep a durable history of past messages.',
    requirements: [
      'Accept and distribute many long-lived client connections.',
      'Push messages to recipients in real time, including ones connected to a different server.',
      'Persist message history durably so it survives restarts.',
      'Serve presence and recent messages fast.',
    ],
    hints: [
      'Real-time means the server pushes to the client; a plain request/response model alone will not cut it (think WebSockets).',
      'A user on server A must receive a message from a user on server B, so your servers need something connecting them.',
      'Use a queue or pub/sub for cross-server fan-out, a fast store for presence and recent messages, and a durable database for history.',
    ],
    requiredComponents: [
      {
        ids: ['lb', 'gateway'],
        min: 1,
        label: 'A load balancer or gateway to accept and distribute client connections.',
      },
      {
        ids: ['webserver', 'microservice'],
        min: 1,
        label: 'A service that maintains the live connections and routes messages.',
      },
      {
        ids: ['queue'],
        min: 1,
        label: 'A message queue or pub/sub that fans messages out across servers.',
      },
      {
        ids: ['nosql', 'sql'],
        min: 1,
        label: 'A database that persists message history.',
      },
      { ids: ['cache'], min: 1, label: 'A cache for presence and recent messages.' },
    ],
    requiredConnections: [
      { from: ['client'], to: ['lb', 'gateway'], label: 'The client opens a connection through the entry point.' },
      {
        from: ['lb', 'gateway'],
        to: ['webserver', 'microservice'],
        label: 'The entry point routes the connection to a chat service.',
      },
      {
        from: ['webserver', 'microservice'],
        to: ['queue'],
        label: 'Services publish and subscribe through the queue to reach clients on other servers.',
      },
      {
        from: ['webserver', 'microservice'],
        to: ['nosql', 'sql'],
        label: 'The service persists messages to the database.',
      },
      {
        from: ['webserver', 'microservice'],
        to: ['cache'],
        label: 'The service reads presence and recent messages from the cache.',
      },
    ],
  },
];

export function getPuzzle(id) {
  return PUZZLES.find((p) => p.id === id);
}
