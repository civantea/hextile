import { access, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const repositoryName = 'hextile';
const clientDirectory = resolve('dist/client');
const pagesDirectory = resolve('dist/pages');
const prefixedAssets = join(pagesDirectory, repositoryName, '_next');
const publicAssets = join(pagesDirectory, '_next');

if (!pagesDirectory.endsWith('/dist/pages')) {
  throw new Error('Directorio de salida inesperado.');
}

await rm(pagesDirectory, { recursive: true, force: true });
await mkdir(pagesDirectory, { recursive: true });
await cp(clientDirectory, pagesDirectory, { recursive: true });
await cp(prefixedAssets, publicAssets, { recursive: true });
await rm(join(pagesDirectory, repositoryName), {
  recursive: true,
  force: true,
});
await writeFile(join(pagesDirectory, '.nojekyll'), '');

const html = await readFile(join(pagesDirectory, 'index.html'), 'utf8');
const publicReferences = [
  ...html.matchAll(/(?:src|href)="(\/hextile\/[^"#?]+)"/g),
].map((match) => match[1]);

for (const reference of new Set(publicReferences)) {
  const artifactPath = join(
    pagesDirectory,
    reference.slice(`/${repositoryName}/`.length),
  );
  await access(artifactPath);
}

console.log(
  `GitHub Pages listo: ${new Set(publicReferences).size} recursos verificados.`,
);
