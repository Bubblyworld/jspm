import c from "picocolors";
import type { Flags } from "./types";
import {
  getEnv,
  getGenerator,
  getInput,
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
  const generator = await getGenerator(flags);

  // Read in any import maps or inline modules in the input:
  let inputPins: string[] = [];
  const input = await getInput(flags);
  if (typeof input !== "undefined") {
    inputPins = await generator.addMappings(input);
  }

  logger.info(`Input map parsed: ${JSON.stringify(input, null, 2)}`);

  startLoading(
    `Updating ${c.bold(
      packages.length ? packages.join(", ") : "everything"
    )}. (${env.join(", ")})`
  );

  // Update the provided packages:
  await generator.update(packages.length ? packages : inputPins);

  stopLoading();
  return await writeOutput(generator, null, env, flags, silent);
}
