import { Generator } from "@jspm/generator";
import c from "picocolors";
import type { Flags } from "./types";
import {
  attachEnv,
  cwdUrl,
  getEnv,
  getInput,
  getInputUrl,
  getResolutions,
  startLoading,
  stopLoading,
  writeOutput,
} from "./utils";
import * as logger from "./logger";

export default async function update(
  packages: string[],
  flags: Flags,
  silent = false
) {
  logger.info(`Updating packages: ${packages.join(", ")}`);
  logger.info(`Flags: ${JSON.stringify(flags)}`);

  const env = await getEnv(flags);
  startLoading(
    `Updating ${c.bold(
      packages.length ? packages.join(", ") : "everything"
    )}. (${env.join(", ")})`
  );

  const generator = new Generator({
    env,
    baseUrl: cwdUrl(),
    mapUrl: getInputUrl(flags),
    resolutions: getResolutions(flags),
  });

  // Read in any import maps or inline modules in the input:
  let inputPins: string[] = [];
  const input = await getInput(flags);
  if (typeof input !== "undefined") {
    inputPins = await generator.addMappings(input);
  }

  // Update the provided packages:
  await generator.update(packages.length ? packages : inputPins);
  const outputMap = generator.getMap();

  // Attach explicit environment keys and write the output:
  stopLoading();
  attachEnv(outputMap, env);
  await writeOutput(outputMap, flags, silent);

  return outputMap;
}
