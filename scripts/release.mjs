// Publishes a new Plico version that installed copies will offer to update to.
//
//   npm run release -- 0.2.0 "What changed, in one or two lines"
//
// 1. sets the version in package.json, tauri.conf.json and Cargo.toml
// 2. builds the installer, signed with the private key in ~/.tauri/plico.key
// 3. writes latest.json (what installed copies read to find the update)
// 4. creates the GitHub release v0.2.0 with the installer and latest.json (needs `gh` signed in)
//
// Add --no-publish to stop after step 3 and look at the files first.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const [version, notes = ''] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const publish = !process.argv.includes('--no-publish');
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  console.error('Usage: npm run release -- 0.2.0 "What changed"');
  process.exit(1);
}

const keyFile = join(homedir(), '.tauri', 'plico.key');
if (!existsSync(keyFile)) {
  console.error(`No signing key at ${keyFile}. Without it, installed copies would refuse the update.`);
  process.exit(1);
}

const run = (cmd, env = {}) => execSync(cmd, { stdio: 'inherit', env: { ...process.env, ...env } });
const edit = (file, from, to) => {
  const text = readFileSync(file, 'utf8');
  if (!from.test(text)) throw new Error(`No version found in ${file}`);
  writeFileSync(file, text.replace(from, to));
};

edit('package.json', /"version": "[^"]+"/, `"version": "${version}"`);
edit('src-tauri/tauri.conf.json', /"version": "[^"]+"/, `"version": "${version}"`);
edit('src-tauri/Cargo.toml', /^version = "[^"]+"/m, `version = "${version}"`);

run('npm run tauri build', {
  TAURI_SIGNING_PRIVATE_KEY: readFileSync(keyFile, 'utf8'),
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD: '',
});

const dir = 'src-tauri/target/release/bundle/nsis';
const exe = `Plico_${version}_x64-setup.exe`;
const latest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': {
      signature: readFileSync(join(dir, `${exe}.sig`), 'utf8'),
      url: `https://github.com/bhavyammisra/plico/releases/download/v${version}/${exe}`,
    },
  },
};
writeFileSync(join(dir, 'latest.json'), JSON.stringify(latest, null, 2));
console.log(`\nBuilt ${join(dir, exe)} and latest.json`);

if (publish) {
  run(`gh release create v${version} "${join(dir, exe)}" "${join(dir, 'latest.json')}" --title "Plico ${version}" --notes ${JSON.stringify(notes || `Plico ${version}`)}`);
  console.log(`Published v${version}. Installed copies will offer it within a few hours, or right away from Settings, Check now.`);
} else {
  console.log('Not published (--no-publish).');
}
