import { createRequire } from "node:module";

const nodeRequire = createRequire(import.meta.url);

// Kept in a variable so the bundler leaves the require alone instead of trying to
// inline package.json. Resolves to the package root from both src/ and dist/.
const pkgPath = "../package.json";

export const VERSION: string = (nodeRequire(pkgPath) as { version: string }).version;
