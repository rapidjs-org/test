import { readdir, existsSync, lstatSync } from "fs";
import { join, resolve as resolvePath } from "path";

import { Test } from "./Test";
import { AsyncMutex } from "./AsyncMutex";
import { Env } from "./Env";

import { FormatError } from "./FormatError";

interface IRecord {
	[key: string]: Test[];
}

/* interface IOptions {
	// TODO (?)
} */

/* const DEFAULT_OPTIONS: IOptions = {

}; */

const curTestRecord: IRecord = {};
const importMutex = new AsyncMutex();

let activeFilepath: string;

function traversePath(path: string) {
	const handleFilepath = (filepath: string) => {
		if (!/[^#][^/]+\.test\.[cm]?js$/.test(filepath)) return;

		importMutex
			.lock(async () => {
				activeFilepath = filepath;
				await import(filepath);
			})
			.catch((err: Error) => {
				throw new FormatError(err, "Cannot evaluate test file");
			});
	};

	if (lstatSync(path).isFile()) {
		handleFilepath(path);

		return;
	}

	readdir(
		path,
		{
			withFileTypes: true
		},
		(err, dirents) => {
			if (err) throw err;

			dirents.forEach((dirent) => {
				const filepath = join(path, dirent.name);
				if (dirent.isDirectory()) {
					traversePath(filepath);

					return;
				}

				handleFilepath(filepath);
			});
		}
	);
}

export { Test } from "./Test";

export interface IResults {
	time: number;
	record: IRecord;
}

export async function init(
	testSuiteModuleReference: string,
	testTargetPath: string /* , options?: IOptions */
): Promise<IResults>;
export async function init(
	testSuiteAPI: { [key: string]: Test },
	testTargetPath: string /* , options?: IOptions */
): Promise<IResults>;
export async function init(apiArg: unknown, testTargetPath: string /* , options?: IOptions */): Promise<IResults> {
	type TTestApi = { [key: string]: Test };
	const testSuiteAPI =
		typeof apiArg === "string"
			? await new Promise<TTestApi>(async (resolve, reject) => {
				const testSuiteModuleReference: string = resolvePath(apiArg);
				!existsSync(testSuiteModuleReference)
					? reject(new ReferenceError(`Test suite module not found '${testSuiteModuleReference}'`))
					: resolve((await import(testSuiteModuleReference)) as TTestApi);
			})
			: (apiArg as { [key: string]: Test });

	const TestClass = Object.entries(testSuiteAPI)[0];
	if (TestClass[0] === "default" || (Object.getPrototypeOf(TestClass[1]) as { name: string }).name !== "Test") {
		throw new SyntaxError("Test suite module must provide a single named concrete Test class export");
	}
	const resolvedTestTargetPath: string = resolvePath(testTargetPath);
	if (!existsSync(resolvedTestTargetPath)) {
		throw new ReferenceError(
			`Test ${/\.test\.js$/i.test(testTargetPath) ? "file" : "directory"} not found '${resolvedTestTargetPath}'`
		);
	}

	/* const optionsWithDefaults: IOptions = {
		...DEFAULT_OPTIONS,
		...options ?? {}
	}; */ // TODO: Use

	// @ts-expect-error Write to global
	global[TestClass[0]] = TestClass[1];

	const testEnv = new Env(testTargetPath);

	return new Promise<IResults>(async (resolve, reject) => {
		try {
			await testEnv.call("BEFORE");
		} catch (err: unknown) {
			reject(err);

			return;
		}

		let wasAborted = false;
		const captureError = async (err: Error) => {
			if (wasAborted) return;
			wasAborted = true;

			await testEnv.call("AFTER");

			reject(err);

			return;
		};
		process.on("uncaughtException", captureError);
		process.on("unhandledRejection", captureError);

		const startTime = Date.now();

		Test.event.on("complete", async () => {
			const time = Date.now() - startTime;

			await testEnv.call("AFTER");

			resolve({
				time,
				record: curTestRecord
			});
		});

		Test.event.on("create", (test: Test) => {
			curTestRecord[activeFilepath] = [curTestRecord[activeFilepath] ?? [], test].flat();
		});

		Test.tryComplete();

		traversePath(resolvedTestTargetPath);
	});
}
