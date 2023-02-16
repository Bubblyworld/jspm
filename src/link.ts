import c from "picocolors";
import type { Flags } from "./types";
import {
  getEnv,
  getGenerator,
  getInput,
  getInputPath,
  getOutputPath,
  startSpinner,
  stopSpinner,
  writeOutput,
} from "./utils";
import * as logger from "./logger";

export default async function link(
  modules: string[],
  flags: Flags,
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

  logger.info(`Input map parsed: ${input}`);

  if (modules.length === 0) {
    !flags.silent && startSpinner(`Linking input.`);
  } else {
    !flags.silent && startSpinner(
      `Linking ${c.bold(
        resolvedModules.map((p) => p.alias || p.target).join(", ")
      )}. (${env.join(", ")})`
    );
  }

  logger.info(`Trace installing: ${inputPins.concat(pins).join(", ")}`);
  await generator.traceInstall(inputPins.concat(pins));

  // If the user has provided modules and the output path is different to the
  // input path, then we behave as an extraction from the input map. In all
  // other cases we behave as an update:
  stopSpinner();
  if (inputMapPath !== outputMapPath && modules.length !== 0) {
    return await writeOutput(generator, pins, env, flags, flags.silent);
  } else {
    return await writeOutput(generator, null, env, flags, flags.silent);
  }
}
