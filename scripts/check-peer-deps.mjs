#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_ROOT = resolve(__dirname, "..");
const PACKAGE_JSON = resolve(PACKAGE_ROOT, "package.json");

// Host-provided rendering stack: always required.
const REQUIRED_PEERS = ["konva", "react", "react-dom", "react-konva"];
// Collab stack: only needed by the ./collab subpath, so optional by design.
const OPTIONAL_PEERS = ["y-protocols", "yjs"];

async function main() {
	const pkg = JSON.parse(await readFile(PACKAGE_JSON, "utf8"));
	const dependencies = pkg.dependencies ?? {};
	const devDependencies = pkg.devDependencies ?? {};
	const peerDependencies = pkg.peerDependencies ?? {};
	const peerDependenciesMeta = pkg.peerDependenciesMeta ?? {};

	const missingRequiredPeers = REQUIRED_PEERS.filter(
		(name) => !(name in peerDependencies),
	);
	const unclassifiedPeers = Object.keys(peerDependencies).filter(
		(name) => !REQUIRED_PEERS.includes(name) && !OPTIONAL_PEERS.includes(name),
	);
	const missingFromDevDependencies = Object.keys(peerDependencies).filter(
		(name) => !(name in devDependencies),
	);
	const wrongRequiredMeta = REQUIRED_PEERS.filter((name) => {
		if (!(name in peerDependencies)) {
			return false;
		}
		const meta = peerDependenciesMeta[name];
		return !meta || meta.optional !== false;
	});
	const wrongOptionalMeta = OPTIONAL_PEERS.filter((name) => {
		if (!(name in peerDependencies)) {
			return false;
		}
		const meta = peerDependenciesMeta[name];
		return !meta || meta.optional !== true;
	});
	const leakedToDependencies = [...REQUIRED_PEERS, ...OPTIONAL_PEERS].filter(
		(name) => name in dependencies,
	);

	if (
		missingRequiredPeers.length === 0 &&
		unclassifiedPeers.length === 0 &&
		missingFromDevDependencies.length === 0 &&
		wrongRequiredMeta.length === 0 &&
		wrongOptionalMeta.length === 0 &&
		leakedToDependencies.length === 0
	) {
		console.log(
			"check-peer-deps: OK — required/optional peers classified, mirrored in devDependencies, and absent from dependencies.",
		);
		return;
	}

	console.error("check-peer-deps: FAIL");
	console.error("");

	if (missingRequiredPeers.length > 0) {
		console.error(
			`  Missing required peerDependencies: ${missingRequiredPeers.join(", ")}`,
		);
		console.error('  Add them under "peerDependencies" in package.json.');
		console.error("");
	}

	if (unclassifiedPeers.length > 0) {
		console.error(`  Unclassified peerDependencies: ${unclassifiedPeers.join(", ")}`);
		console.error(
			"  Add each new peer to REQUIRED_PEERS or OPTIONAL_PEERS in this script — optionality must be a conscious decision.",
		);
		console.error("");
	}

	if (missingFromDevDependencies.length > 0) {
		console.error(
			`  Missing from devDependencies: ${missingFromDevDependencies.join(", ")}`,
		);
		console.error(
			'  Mirror every peer dependency in "devDependencies" so local builds resolve.',
		);
		console.error("");
	}

	if (wrongRequiredMeta.length > 0) {
		console.error(
			`  Required peers without explicit { "optional": false } meta: ${wrongRequiredMeta.join(", ")}`,
		);
		console.error(
			'  Every required peer must have "peerDependenciesMeta": { "<name>": { "optional": false } }.',
		);
		console.error("");
	}

	if (wrongOptionalMeta.length > 0) {
		console.error(
			`  Optional peers without explicit { "optional": true } meta: ${wrongOptionalMeta.join(", ")}`,
		);
		console.error(
			"  The collab peers must stay optional so non-collab consumers install cleanly.",
		);
		console.error("");
	}

	if (leakedToDependencies.length > 0) {
		console.error(`  Leaked into dependencies: ${leakedToDependencies.join(", ")}`);
		console.error(
			'  Remove peers from "dependencies" so consumers do not install duplicate runtime copies.',
		);
		console.error("");
	}

	process.exit(1);
}

main().catch((error) => {
	console.error("check-peer-deps: crashed unexpectedly");
	console.error(error);
	process.exit(2);
});
