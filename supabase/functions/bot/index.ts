import { buildDeps } from '../../../src/app/build-deps.ts';
import { readConfig } from '../../../src/app/config.ts';
import { createHttpHandler } from '../../../src/app/http.ts';

const config = readConfig((k) => Deno.env.get(k));
Deno.serve(createHttpHandler(buildDeps(config), config));
