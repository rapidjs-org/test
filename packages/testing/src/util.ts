export async function importDynamically<T>(reference: string): Promise<T> {
	let resolvedReference: string;
	try {
		resolvedReference = require.resolve(reference);
	} catch {
		return null;
	}

	// eslint-disable-next-line @typescript-eslint/no-implied-eval
	return (await new Function(`return import("${resolvedReference}")`)()) as T;
}
