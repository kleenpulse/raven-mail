import { afterAll, describe, expect, test } from "bun:test";
import { createServer, type AddressInfo, type Server } from "node:net";
import { canReach } from "./reach";

const servers: Server[] = [];

function listen(): Promise<number> {
	return new Promise((resolve) => {
		const server = createServer((socket) => socket.end());
		servers.push(server);
		server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
	});
}

async function closedPort(): Promise<number> {
	const server = createServer();
	const port = await new Promise<number>((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)));
	await new Promise((resolve) => server.close(resolve));
	return port;
}

afterAll(() => {
	for (const server of servers) server.close();
});

describe("canReach", () => {
	test("true when something accepts the connection", async () => {
		expect(await canReach("127.0.0.1", await listen())).toBe(true);
	});

	test("false when the port refuses", async () => {
		expect(await canReach("127.0.0.1", await closedPort())).toBe(false);
	});

	test("false for a host that doesn't resolve", async () => {
		expect(await canReach("raven-reach-test.invalid", 993, 2000)).toBe(false);
	});
});
