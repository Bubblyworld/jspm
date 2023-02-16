import c from "picocolors";
import type { Flags } from "./types";
import {
  getEnv,
  getGenerator,
  getInput,
  getInputPath,
  getOutputPath,
  parsePackageSpec,
  startLoading,
  stopLoading,
  writeOutput,
} from "./utils";
import * as log from "./logger";

export default async function install(
  packages: string[],
  flags: Flags,
  silent = false
) {
  log.info(`Installing packages: ${packages.join(", ")}`);
  log.info(`Flags: ${JSON.stringify(flags)}`);

  const resolvedPackages = packages.map((p) => {
    if (!p.includes("=")) return { target: p };
    const [alias, target] = p.split("=");
    return { alias, target };
  });

  const env = await getEnv(flags);
  const input = await getInput(flags);
  const generator = await getGenerator(flags);
  if (typeof input !== "undefined") await generator.addMappings(input);

  log.info(`Input map parsed: ${JSON.stringify(input, null, 2)}`);

  // Install provided packages, or reinstall existing if none provided:
  if (resolvedPackages.length) {
    startLoading(
      `Installing ${c.bold(
        resolvedPackages.map((p) => p.alias || p.target).join(", ")
      )}. (${env.join(", ")})`
    );
    await generator.install(resolvedPackages);
  } else {
    startLoading(`Reinstalling all top-level imports.`);
    await generator.reinstall();
  }

  // If the input and output maps are the same, we behave in an additive way
  // and trace all top-level pins to the output file. Otherwise, we behave as
  // an extraction and only trace the provided packages to the output file.
  stopLoading();
  const inputMapPath = getInputPath(flags);
  const outputMapPath = getOutputPath(flags);
  if (inputMapPath !== outputMapPath && resolvedPackages.length) {
    const pins = resolvedPackages.map((p) =>
      parsePackageSpec(p.alias || p.target)
    );

    return await writeOutput(generator, pins, env, flags, silent);
  } else {
    return await writeOutput(generator, null, env, flags, silent);
  }
}
