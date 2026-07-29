import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve as resolvePath } from 'node:path';

const resolveDirMain = dirUrl => {
  const dirPath = fileURLToPath(dirUrl);
  const pkg = JSON.parse(
    readFileSync(resolvePath(dirPath, 'package.json'), 'utf8')
  );
  const entry = pkg.main ?? pkg.module;
  if (!entry) {
    throw new Error(`No main/module in ${dirPath}/package.json`);
  }
  return pathToFileURL(resolvePath(dirPath, entry)).href;
};

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (error?.code === 'ERR_UNSUPPORTED_DIR_IMPORT' && error.url) {
      try {
        return await nextResolve(`${specifier}/index.js`, context);
      } catch {
        return { url: resolveDirMain(error.url), shortCircuit: true };
      }
    }
    if (
      error?.code !== 'ERR_MODULE_NOT_FOUND' ||
      /\.(js|mjs|cjs|json)$/.test(specifier)
    ) {
      throw error;
    }
    try {
      return await nextResolve(`${specifier}.js`, context);
    } catch {
      try {
        return await nextResolve(`${specifier}/index.js`, context);
      } catch (finalError) {
        if (
          finalError?.code === 'ERR_UNSUPPORTED_DIR_IMPORT' &&
          finalError.url
        ) {
          return { url: resolveDirMain(finalError.url), shortCircuit: true };
        }
        throw finalError;
      }
    }
  }
}
