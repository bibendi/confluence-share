import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";

const targetVersion = process.env.npm_package_version;

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync("manifest.json", JSON.stringify(manifest, null, "\t"));

const versions = JSON.parse(readFileSync('versions.json', 'utf8'));
let versionsChanged = false;
if (!Object.values(versions).includes(minAppVersion)) {
	versions[targetVersion] = minAppVersion;
	writeFileSync('versions.json', JSON.stringify(versions, null, '\t'));
	versionsChanged = true;
}

// npm version auto-stages package.json but NOT files touched by the version
// lifecycle script, so we explicitly stage them here. Without this, the
// "Verify version matches tag" step in release.yml fails because manifest.json
// in the tagged commit lags behind package.json.
const toStage = ['manifest.json'];
if (versionsChanged) toStage.push('versions.json');
execSync(`git add ${toStage.join(' ')}`, { stdio: 'inherit' });
