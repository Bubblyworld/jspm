import { start } from "fresh/server.ts";
import * as $0 from "./routes/index.tsx";

const manifest = {
  routes: {
    "./routes/index.tsx": $0,
  },
  islands: {},
  baseUrl: import.meta.url,
}

await start(manifest);
