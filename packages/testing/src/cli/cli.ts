#!/usr/bin/env node

import { readFileSync } from "fs";
import { join, resolve as resolvePath } from "path";

import { TColor } from "../types";
import { IResults, init } from "../api";

import { Args } from "./Args";
import { Printer } from "./Printer";

import OFFICIAL_SUITES from "./suites.json";
import { importDynamically } from "../util";

async function runSuite(): Promise<IResults> {
	const commandOrTestSuiteModulePath = Args.parsePositional(0);

	if (commandOrTestSuiteModulePath === "help" || Args.parseFlag("help", "H")) {
		console.log(readFileSync(join(__dirname, "../../help.txt")).toString());
		return;
	}

	if (commandOrTestSuiteModulePath === "gen") {
		await importDynamically("./cli.gen");

		return;
	}

	const testSuiteModulePath: string = commandOrTestSuiteModulePath;
	if (!testSuiteModulePath) throw new ReferenceError("Missing test suite name (pos 0)");
	if (!Args.parsePositional(1)) throw new ReferenceError("Missing test directory path (pos 1)");

	let testSuiteModuleReference: string;
	try {
		testSuiteModuleReference = require.resolve(
			(OFFICIAL_SUITES as { [key: string]: string })[testSuiteModulePath] ?? testSuiteModulePath
		);
	} catch {
		// TODO: Install if is NPM-ish?
		testSuiteModuleReference = resolvePath(testSuiteModulePath);
	}

	try {
		const TestClass = Object.values(await importDynamically(testSuiteModuleReference))[0] as {
			suiteTitle: string;
			suiteColor: TColor;
		};
		Printer.badge(
			(TestClass.suiteTitle || "").replace(/( ?test(s)?)?$/i, " tests"),
			TestClass.suiteColor ?? [225, 225, 225]
		);
	} catch {}

	init(testSuiteModuleReference, Args.parsePositional(1))
		.then((results: IResults) => {
			const counter = {
				success: 0,
				failure: 0
			};

			if (!Object.keys(results.record).length) {
				Printer.warn("No tests defined");

				process.exit(0);
			}

			for (const filepath in results.record) {
				Printer.newline();
				Printer.log(`• ${filepath}`);

				!results.record[filepath].length && Printer.warn("No test case defined");

				const separator = `\x1b[2m${"–".repeat(
					Object.values(results.record[filepath]).reduce(
						(acc: number, test) => Math.max(acc, test.title.length),
						0
					) + 2
				)}`;

				for (const test of results.record[filepath]) {
					counter.success += +test.wasSuccessful;
					counter.failure += +!test.wasSuccessful;

					const indicator = `\x1b[2m\x1b[30m∟\x1b[22m\x1b[39m `;

					if (test.wasSuccessful) {
						Printer.success(`${indicator}${test.title}`);

						continue;
					}

					const source: string = test.sourcePosition
						? `${test.sourcePosition.path}${
								test.sourcePosition.line ? `:${test.sourcePosition.line}` : ""
							}${test.sourcePosition.column ? `:${test.sourcePosition.column}` : ""}`
						: "unknown source";
					Printer.failure(
						`${indicator}${test.title}${test.sourcePosition ? ` \x1b[2m\x1b[30m(${source})\x1b[0m` : ""}`
					);
					Printer.newline();
					Printer.log("\x1b[1m\x1b[2mEXPECTED:");
					Printer.newline();
					Printer.value(test.difference.expected);
					Printer.newline();
					Printer.log("\x1b[1m\x1b[2mACTUAL:");
					Printer.newline();
					Printer.value(test.difference.actual);
					Printer.log(separator);
				}
			}

			const testInfo = `\x1b[30m(${Math.round(
				(counter.success / (counter.success + counter.failure || 1)) * 100
			)}% (${counter.success}/${counter.success + counter.failure}) successful, ${
				results.time > 1000
					? `${Math.round((results.time * 0.001 + Number.EPSILON) * 100) / 100}s`
					: `${results.time}ms`
			})`;
			Printer.newline();
			!counter.failure
				? Printer.success(`Test suite \x1b[1msucceeded\x1b[22m ${testInfo}`)
				: Printer.failure(`Test suite \x1b[1mfailed\x1b[22m ${testInfo}`);

			process.exit(counter.failure ? 1 : 0);
		})
		.catch((err: Error) => {
			setImmediate(() => process.exit(1));

			if (!(err instanceof Error)) {
				console.error(
					`\n\x1b[31mTest suite interrupted by unexpected error:\n${
						["string", "number", "boolean"].includes(typeof err)
							? (err as string | number | boolean).toString()
							: JSON.stringify(err)
					}\x1b[0m`
				);

				return;
			}

			const testFileMentionRegex = /([^/]+\.test\.js)([^\w\d]|$)/;
			const errorStackLines: string[] = (err.stack ?? `${err.name}: ${err.message}`).split(/\n/g);
			console.error(
				`\n\x1b[31m${[errorStackLines.slice(0, -1), errorStackLines.slice(-1)[0]]
					.flat()
					.join("\n")
					.replace(testFileMentionRegex, "\x1b[1m$1\x1b[22m$2")}\x1b[0m`
			);
		});
}

runSuite();
