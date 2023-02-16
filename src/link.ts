import c from "picocolors";
import type { Flags } from "./types";
import {
  getEnv,
  getGenerator,
  getInput,
  getInputPath,
  getOutputPath,
  startLoading,
  stopLoading,
  writeOutput,
} from "./utils";
import * as logger from "./logger";

export default async function link(
  modules: string[],
  flags: Flags,
  silent = false
) {
  logger.info(`Linking modules: ${modules.join(", ")}`);
  logger.info(`Flags: ${JSON.stringify(flags)}`);

  const resolvedModules = modules.map((p) => {
    if (!p.includes("=")) return { target: p };
    const [alias, target] = p.split("=");
    return { alias, target };
  });

  const env = await getEnv(flags);
  const inputMapPath = getInputPath(flags);
  const outputMapPath = getOutputPath(flags);
  const generator = await getGenerator(flags);

  // The input map is either from a JSON file or extracted from an HTML file.
  // In the latter case we want to trace any inline modules from the HTML file
  // as well, since they may have imports that are not in the import map yet:
  let inputPins = [];
  const input = await getInput(flags);
  const pins = resolvedModules.map((p) => p.target);
  if (typeof input !== "undefined") {
    inputPins = pins.concat(await generator.addMappings(input));
  }

  logger.info(`Input map parsed: ${JSON.stringify(input)}`);

  if (modules.length === 0) {
    startLoading(`Linking input.`);
  } else {
    startLoading(
      `Linking ${c.bold(
        resolvedModules.map((p) => p.alias || p.target).join(", ")
      )}. (${env.join(", ")})`
    );
  }

  await generator.traceInstall(inputPins.concat(pins));

  // If the user has provided modules and the output path is different to the
  // input path, then we behave as an extraction from the input map. In all
  // other cases we behave as an update:
  stopLoading();
  if (inputMapPath !== outputMapPath && modules.length !== 0) {
    return await writeOutput(generator, pins, env, flags, silent);
  } else {
    return await writeOutput(generator, null, env, flags, silent);
  }
}
