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

export default async function uninstall(
  packages: string[],
  flags: Flags,
  silent = false
) {
  logger.info(`Uninstalling packages: ${packages.join(", ")}`);
  logger.info(`Flags: ${JSON.stringify(flags)}`);

  if (packages.length === 0) {
    console.log("No packages provided to uninstall.");
    return;
  }

  const env = await getEnv(flags);
  const input = await getInput(flags);
  const generator = await getGenerator(flags);
  if (typeof input !== "undefined") await generator.addMappings(input);

  logger.info(`Input map parsed: ${JSON.stringify(input, null, 2)}`);

  startLoading(
    `Uninstalling ${c.bold(packages.join(", "))}. (${env.join(", ")})`
  );

  // Uninstall the provided packages.
  await generator.uninstall(packages);

  stopLoading();
  return await writeOutput(generator, null, env, flags, silent);
}
