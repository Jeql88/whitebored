// Base URL for the API + Socket.IO connection.
//
// Production: same-origin monolith → window.location.origin.
// Development: Vite proxies /api and /socket.io to the node server, so
// window.location.origin (the Vite dev origin) still works.
// Override with VITE_API_BASE only if the API lives on a different host.
export const API_BASE =
  import.meta.env.VITE_API_BASE ?? window.location.origin;
