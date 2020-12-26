/*
 *   Copyright 2014-2020 Guy Bedford (http://guybedford.com)
 *
 *   Licensed under the Apache License, Version 2.0 (the "License");
 *   you may not use this file except in compliance with the License.
 *   You may obtain a copy of the License at
 *
 *       http://www.apache.org/licenses/LICENSE-2.0
 *
 *   Unless required by applicable law or agreed to in writing, software
 *   distributed under the License is distributed on an "AS IS" BASIS,
 *   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *   See the License for the specific language governing permissions and
 *   limitations under the License.
 */
import process from 'process';
import { isWindows, PATH, PATHS_SEP } from '../common/env.ts';

export async function runCmd (script: string, projectPath: string, cwd?: string): Promise<number>
export async function runCmd (script: string, projectPath: string, cwd: string, pipe: true): Promise<childProcess.ChildProcess>
export async function runCmd (script: string, projectPath = process.env.PWD || process.cwd(), cwd = projectPath, pipe = false): Promise<childProcess.ChildProcess | number> {
  const env = Object.create(null);
  
  const pathArr = [];
  // pathArr.push(path.join(cwd, 'node-gyp-bin'));
  // pathArr.push(path.join(projectPath, 'node_modules', '.bin'));
  pathArr.push(process.env[PATH]);

  Object.assign(env, process.env);
  env[PATH] = pathArr.join(PATHS_SEP);
  const sh = isWindows ? process.env.comspec || 'cmd' : 'sh';
  const shFlag = isWindows ? '/d /s /c' : '-c';

  if (typeof Deno !== 'undefined') {
    const ps = Deno.run({
      cmd: [sh, shFlag, script],
      env,
      stdio: pipe ? 'piped' : 'inherit'
    });
    if (pipe)
      return ps;
    const { success, code, signal } = await ps.status();
    return code;
  }
  else {
    const childProcess = require('child_process');
    const ps = childProcess.spawn(sh, [shFlag, script], { cwd, env, stdio: pipe ? 'pipe' : 'inherit', windowsVerbatimArguments: true });
    if (pipe)
      return ps;
    return new Promise<number>((resolve, reject) => ps.on('close', resolve).on('error', reject));
  }
}