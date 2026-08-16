/**
 * The header the middleware stamps the request path onto.
 *
 * Its own module, and free of everything else, because both ends of it are
 * constrained: the middleware runs on the Edge runtime and may not import
 * Mongoose or `node:crypto` even transitively, and `lib/auth/guard` — which
 * reads the header — imports both. One shared constant is all they need of each
 * other, and a name spelled out twice would eventually be spelled two ways.
 */
export const PATH_HEADER = "x-bhealix-path";
