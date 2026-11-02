import semanticRelease from 'semantic-release';
import { appendFileSync } from 'node:fs';

const result = await semanticRelease();
const release = result?.nextRelease;
const outputs = release
  ? {
      released: 'true',
      version: release.version,
      tag: release.gitTag,
      sha: release.gitHead,
    }
  : { released: 'false', version: '', tag: '', sha: '' };

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    Object.entries(outputs)
      .map(([key, value]) => `${key}=${value}\n`)
      .join(''),
  );
}
console.log(
  release ? `Released ${outputs.tag}` : 'No release-worthy changes; deployment jobs will be skipped.',
);
