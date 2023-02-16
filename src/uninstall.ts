import c from "picocolors";
import type { Flags } from "./types";
import {
  getEnv,
  getGenerator,
  getInput,
  startSpinner,
  stopSpinner,
  writeOutput,
} from "./utils";
import * as logger from "./logger";

export default async function uninstall(
  packages: string[],
  flags: Flags,
) {
  logger.info(`Uninstalling packages: ${packages.join(", ")}`);
  logger.info(`Flags: ${JSON.stringify(flags)}`);

  if (packages.length === 0) {
    !flags.silent && console.log("No packages provided to uninstall.");
    return;
  }

  const env = await getEnv(flags);
  const input = await getInput(flags);
  const generator = await getGenerator(flags);
  if (typeof input !== "undefined") await generator.addMappings(input);

  logger.info(`Input map parsed: ${input}`);

  !flags.silent && startSpinner(
    `Uninstalling ${c.bold(packages.join(", "))}. (${env.join(", ")})`
  );

  // Uninstall the provided packages.
  await generator.uninstall(packages);

  stopSpinner();
  return await writeOutput(generator, null, env, flags, flags.silent);
}
