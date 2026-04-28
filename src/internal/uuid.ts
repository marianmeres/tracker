/**
 * Returns a v4-style UUID. Uses `crypto.randomUUID` when available; otherwise
 * falls back to `crypto.getRandomValues` and finally to `Math.random` so the
 * function never throws in exotic environments.
 */
export function uuid(): string {
	const c = (globalThis as { crypto?: Crypto }).crypto;

	if (c?.randomUUID) {
		return c.randomUUID();
	}

	const bytes = new Uint8Array(16);
	if (c?.getRandomValues) {
		c.getRandomValues(bytes);
	} else {
		for (let i = 0; i < 16; i++) bytes[i] = (Math.random() * 256) | 0;
	}

	bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
	bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10

	const hex: string[] = [];
	for (let i = 0; i < 16; i++) hex.push(bytes[i].toString(16).padStart(2, "0"));
	return (
		hex.slice(0, 4).join("") +
		"-" +
		hex.slice(4, 6).join("") +
		"-" +
		hex.slice(6, 8).join("") +
		"-" +
		hex.slice(8, 10).join("") +
		"-" +
		hex.slice(10, 16).join("")
	);
}
